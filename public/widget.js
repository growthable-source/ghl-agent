/**
 * Xovera Widget — embed loader
 *
 * Chat widget (floating launcher → chat iframe):
 *   <script src="https://your-host.com/widget.js"
 *           data-widget-id="wgt_xxx"
 *           data-public-key="widget_pub_xxx"
 *           async></script>
 *
 * Click-to-call widget (floating button → voice iframe):
 *   Same snippet — type comes from server config.
 *
 * Click-to-call inline (button rendered into a host-page div):
 *   <div id="xovera-call"></div>
 *   <script src="…/widget.js"
 *           data-widget-id="wgt_xxx"
 *           data-public-key="widget_pub_xxx"
 *           data-mount="#xovera-call"
 *           async></script>
 */
(function () {
  if (window.__xoveraLoaded) return
  window.__xoveraLoaded = true

  var me = document.currentScript
  if (!me) {
    var scripts = document.getElementsByTagName('script')
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf('widget.js') !== -1) { me = scripts[i]; break }
    }
  }
  if (!me) { console.warn('[Xovera] Could not find widget script tag'); return }

  var widgetId = me.getAttribute('data-widget-id') || me.getAttribute('data-key')
  var publicKey = me.getAttribute('data-public-key') || me.getAttribute('data-pk')
  var mountSelector = me.getAttribute('data-mount')
  // Optional per-location identity for the agency kill switch. The CRM
  // resolves {{location.id}} per sub-account when the snippet is installed
  // via agency custom code — but on plain sites the literal braces come
  // through untouched, so treat an unreplaced merge tag as absent.
  var locationId = me.getAttribute('data-location-id')
  if (locationId && (locationId.indexOf('{{') !== -1 || !locationId.trim())) locationId = null
  if (!widgetId || !publicKey) {
    console.warn('[Xovera] widget.js needs data-widget-id and data-public-key attributes')
    return
  }

  var hostUrl
  try { hostUrl = new URL(me.src).origin } catch (_) { hostUrl = '' }

  var state = {
    open: false,
    config: null,
    launcher: null,
    launcherDisplay: 'flex',
    iframe: null,
    iframeWrap: null,
    identity: null,
  }

  // ─── Visibility kill switch ─────────────────────────────────────────
  // Host pages (e.g. a CRM dashboard where the widget gets in the way of
  // real work) can hide the widget per-browser via Xovera.hide()/show().
  // Persisted so the choice survives SPA navigations and reloads.
  var VIS_KEY = 'xovera_widget_hidden'
  function visHidden() {
    try { return localStorage.getItem(VIS_KEY) === '1' } catch (_) { return false }
  }
  function setHidden(h) {
    try { h ? localStorage.setItem(VIS_KEY, '1') : localStorage.removeItem(VIS_KEY) } catch (_) {}
    if (h && state.open) toggleIframe(state.launcher, state.config && state.config.type !== 'click_to_call')
    if (state.launcher) state.launcher.style.display = h ? 'none' : state.launcherDisplay
  }

  fetch(hostUrl + '/api/widget/' + widgetId + '/config?pk=' + encodeURIComponent(publicKey)
      + (locationId ? '&locationId=' + encodeURIComponent(locationId) : ''))
    .then(function (r) { return r.json() })
    .then(function (cfg) {
      if (cfg && cfg.disabled) return   // location toggled off — render nothing
      if (cfg && cfg.id) { state.config = cfg; render(); startVisitorTracking() }
    })
    .catch(function (e) { console.warn('[Xovera] config fetch failed:', e) })

  // ─── Visitor tracking ──────────────────────────────────────────────
  // Fires page_view events to /visitor/events so the operator inbox
  // can show a timeline of where the visitor has been on the site.
  // Best-effort — failures are silent. SPA-aware: re-fires on
  // history.pushState / popstate, with the host route capped via the
  // server-side 60s same-URL dedupe.
  var VISITOR_KEY = 'voxility_visitor_id'
  function getCookieId() {
    try {
      var id = localStorage.getItem(VISITOR_KEY)
      if (id) return id
      id = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
      localStorage.setItem(VISITOR_KEY, id)
      return id
    } catch (_) { return null }
  }
  function sendEvent(kind, data) {
    var cookieId = getCookieId()
    if (!cookieId) return
    try {
      var url = hostUrl + '/api/widget/' + widgetId + '/visitor/events?pk=' + encodeURIComponent(publicKey)
      var body = JSON.stringify({ cookieId: cookieId, kind: kind, data: data || {} })
      // CRITICAL: the body must go as text/plain, NOT application/json.
      // A cross-origin request with a JSON content type needs a CORS
      // preflight, and beacons can't preflight — so the old
      // sendBeacon(new Blob([body], {type:'application/json'})) version
      // was SILENTLY DROPPED by the browser on every real customer site
      // (sendBeacon still returned true, so the fetch fallback never ran
      // either). Result: zero page_view events ever recorded from any
      // host page. A plain STRING beacon goes out as
      // text/plain;charset=UTF-8 — CORS-safelisted, no preflight — and
      // the server JSON-parses the text body.
      if (navigator.sendBeacon && navigator.sendBeacon(url, body)) return
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: body, keepalive: true })
        .catch(function () {})
    } catch (_) {}
  }
  function currentPageData() {
    return {
      url: location.href,
      title: document.title,
      referrer: document.referrer || null,
      path: location.pathname,
      search: location.search || null,
    }
  }
  // Parent-page context to hand the iframe. The chat/call pages run on
  // the Xovera origin INSIDE an iframe, so their own window.location is
  // the embed URL — useless for "which page/site did this chat come
  // from?". We pass the host page's real URL + title through the query
  // string so the embed can record it as the conversation's origin
  // (initiatedUrl). Empty fragment when we somehow have no URL.
  function parentContextQuery() {
    try {
      var q = '&purl=' + encodeURIComponent(location.href)
      if (document.title) q += '&ptitle=' + encodeURIComponent(document.title.slice(0, 300))
      return q
    } catch (_) { return '' }
  }
  function startVisitorTracking() {
    // Fire once on load.
    sendEvent('page_view', currentPageData())
    // SPA navigation: monkey-patch pushState + replaceState so we hear
    // every router transition, plus listen for popstate (back/forward).
    var origPush = history.pushState
    var origReplace = history.replaceState
    history.pushState = function () {
      var ret = origPush.apply(this, arguments)
      try { sendEvent('page_view', currentPageData()) } catch (_) {}
      return ret
    }
    history.replaceState = function () {
      var ret = origReplace.apply(this, arguments)
      try { sendEvent('page_view', currentPageData()) } catch (_) {}
      return ret
    }
    window.addEventListener('popstate', function () {
      try { sendEvent('page_view', currentPageData()) } catch (_) {}
    })
  }

  function render() {
    var cfg = state.config
    if (cfg.type === 'click_to_call') {
      renderCallButton(cfg)
    } else {
      renderChatLauncher(cfg)
    }
  }

  // ─── Chat: floating launcher + chat iframe ──────────────────────────
  function renderChatLauncher(cfg) {
    var position = cfg.position === 'bottom-left' ? 'left' : 'right'

    var btn = document.createElement('button')
    btn.setAttribute('aria-label', 'Open chat')
    btn.style.cssText = [
      'position:fixed', 'bottom:20px', position + ':20px',
      'width:56px', 'height:56px', 'border-radius:50%',
      'background:' + cfg.primaryColor, 'color:#fff',
      'border:none', 'cursor:pointer', 'z-index:2147483646',
      'box-shadow:0 8px 24px rgba(0,0,0,0.18)', 'display:flex',
      'align-items:center', 'justify-content:center',
      'transition:transform 0.2s ease, box-shadow 0.2s ease',
      'font-family:system-ui,-apple-system,sans-serif',
    ].join(';')
    btn.innerHTML = svgChat()
    btn.onmouseenter = function () { btn.style.transform = 'scale(1.05)' }
    btn.onmouseleave = function () { btn.style.transform = 'scale(1)' }
    btn.onclick = function () {
      // Swallow the click that ends a drag so dragging the launcher
      // doesn't also open/close the panel.
      if (btn.__voxDragged) { btn.__voxDragged = false; return }
      toggleIframe(btn, true)
    }
    document.body.appendChild(btn)
    state.launcher = btn
    state.launcherDisplay = 'flex'
    if (visHidden()) btn.style.display = 'none'

    // Pass the parent-page cookieId into the iframe so chat
    // conversations + page_view events end up on the same WidgetVisitor
    // row. Without this, iframe and parent-page localStorage diverge
    // (different origins), and the visitor panel never sees page
    // history for a chat.
    var cid = getCookieId() || ''
    var embedUrl = hostUrl + '/widget/' + widgetId + '/embed?pk=' + encodeURIComponent(publicKey)
      + (cid ? '&cid=' + encodeURIComponent(cid) : '')
      + (locationId ? '&loc=' + encodeURIComponent(locationId) : '')
      + parentContextQuery()
      + identityQuery()
    var wrap = buildIframe(embedUrl, cfg.title || 'Chat', position, false)
    document.body.appendChild(wrap)
    state.iframeWrap = wrap
    makeDraggable(btn, wrap, position)
  }

  // ─── Click-to-call: button (floating or inline) + voice iframe ──────
  function renderCallButton(cfg) {
    var floating = !mountSelector && cfg.embedMode !== 'inline'
    var position = cfg.position === 'bottom-left' ? 'left' : 'right'
    var radii = { pill: '999px', rounded: '12px', square: '4px' }
    var pads = { sm: '8px 14px', md: '12px 20px', lg: '16px 28px' }
    var fonts = { sm: '13px', md: '15px', lg: '17px' }

    var btn = document.createElement('button')
    btn.setAttribute('aria-label', cfg.buttonLabel || 'Call')
    var styles = [
      'background:' + cfg.primaryColor,
      'color:' + (cfg.buttonTextColor || '#ffffff'),
      'border:none',
      'cursor:pointer',
      'border-radius:' + (radii[cfg.buttonShape] || radii.pill),
      'padding:' + (pads[cfg.buttonSize] || pads.md),
      'font:' + '600 ' + (fonts[cfg.buttonSize] || fonts.md) + ' system-ui,-apple-system,sans-serif',
      'display:inline-flex',
      'align-items:center',
      'gap:8px',
      'box-shadow:0 4px 14px rgba(0,0,0,0.18)',
      'transition:transform 0.15s ease, box-shadow 0.15s ease',
    ]
    if (floating) {
      styles.push('position:fixed')
      styles.push('bottom:20px')
      styles.push(position + ':20px')
      styles.push('z-index:2147483646')
    }
    btn.style.cssText = styles.join(';')
    var iconHtml = ''
    if (cfg.buttonIcon === 'phone') iconHtml = svgPhone()
    else if (cfg.buttonIcon === 'mic') iconHtml = svgMic()
    btn.innerHTML = iconHtml + '<span>' + escapeHtml(cfg.buttonLabel || 'Talk to us') + '</span>'
    btn.onmouseenter = function () { btn.style.transform = 'translateY(-1px)'; btn.style.boxShadow = '0 6px 18px rgba(0,0,0,0.22)' }
    btn.onmouseleave = function () { btn.style.transform = 'translateY(0)'; btn.style.boxShadow = '0 4px 14px rgba(0,0,0,0.18)' }
    btn.onclick = function () {
      if (btn.__voxDragged) { btn.__voxDragged = false; return }
      toggleIframe(btn, false)
    }

    if (floating) {
      document.body.appendChild(btn)
    } else {
      var mount = mountSelector ? document.querySelector(mountSelector) : null
      if (!mount) {
        console.warn('[Xovera] inline mount target not found:', mountSelector || '#xovera-call')
        return
      }
      mount.appendChild(btn)
    }
    state.launcher = btn
    state.launcherDisplay = 'inline-flex'
    if (visHidden()) btn.style.display = 'none'

    // Same cookieId hand-off as the chat widget — keeps page_view
    // events fired by the parent on the same visitor row as any
    // future call-side identify/CRM sync.
    var ccid = getCookieId() || ''
    var callUrl = hostUrl + '/widget/' + widgetId + '/call?pk=' + encodeURIComponent(publicKey)
      + (ccid ? '&cid=' + encodeURIComponent(ccid) : '')
      + parentContextQuery()
    var wrap = buildIframe(callUrl, cfg.buttonLabel || 'Call', position, true)
    document.body.appendChild(wrap)
    state.iframeWrap = wrap
    // Only the FLOATING launcher is position:fixed and drag-repositionable;
    // an inline in-page button stays where the host put it.
    if (floating) makeDraggable(btn, wrap, position)
  }

  function buildIframe(src, title, position, isCall) {
    var wrap = document.createElement('div')
    var width = isCall ? 'min(360px,calc(100vw - 40px))' : 'min(380px,calc(100vw - 40px))'
    var height = isCall ? 'min(440px,calc(100vh - 120px))' : 'min(620px,calc(100vh - 120px))'
    wrap.style.cssText = [
      'position:fixed', 'bottom:90px', position + ':20px',
      'width:' + width, 'height:' + height,
      'border-radius:16px', 'overflow:hidden',
      'box-shadow:0 12px 40px rgba(0,0,0,0.25)',
      'z-index:2147483647', 'display:none',
      'background:#09090b',
      'border:1px solid #27272a',
      'transition:opacity 0.2s ease, transform 0.2s ease',
      'opacity:0', 'transform:translateY(12px)',
      // Closed/animating panel must never intercept clicks: during the
      // 220ms close fade the wrap is invisible (opacity 0) but still
      // display:block over a ~380x620 region right above the launcher —
      // without this, clicks there are silently swallowed.
      'pointer-events:none',
    ].join(';')
    var iframe = document.createElement('iframe')
    iframe.src = src
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#09090b'
    iframe.setAttribute('title', title)
    iframe.setAttribute('allow', 'microphone')
    wrap.appendChild(iframe)
    state.iframe = iframe
    return wrap
  }

  function toggleIframe(launcher, swapIcon) {
    state.open = !state.open
    if (state.open) {
      state.iframeWrap.style.display = 'block'
      state.iframeWrap.style.pointerEvents = 'auto'
      requestAnimationFrame(function () {
        state.iframeWrap.style.opacity = '1'
        state.iframeWrap.style.transform = 'translateY(0)'
      })
      if (swapIcon && launcher) launcher.innerHTML = svgClose()
      // Re-send any host-supplied identity on open — covers identify()
      // calls that landed while the iframe was still booting and missed
      // the live postMessage.
      pushIdentity()
    } else {
      state.iframeWrap.style.pointerEvents = 'none'
      state.iframeWrap.style.opacity = '0'
      state.iframeWrap.style.transform = 'translateY(12px)'
      setTimeout(function () { if (!state.open) state.iframeWrap.style.display = 'none' }, 220)
      if (swapIcon && launcher) launcher.innerHTML = svgChat()
    }
  }

  // ─── Draggable launcher ─────────────────────────────────────────────
  // Let the visitor reposition the floating widget so it stops covering
  // a "Buy" button / chat input / cookie banner. We drag the LAUNCHER
  // (the iframe is cross-origin so we can't grab its insides) and move
  // the panel with it, keeping their 70px gap. Position persists per
  // widget in localStorage. A movement threshold distinguishes a drag
  // from a plain click so opening the widget still works.
  var POS_KEY = 'xovera_widget_pos_' + widgetId
  function loadPos() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || 'null') } catch (_) { return null }
  }
  function savePos(p) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)) } catch (_) {}
  }
  function applyPos(el, side, sidePx, bottomPx) {
    if (!el) return
    el.style.bottom = bottomPx + 'px'
    el.style[side] = sidePx + 'px'
    el.style[side === 'left' ? 'right' : 'left'] = 'auto'
  }
  function makeDraggable(launcher, wrap, side) {
    var WRAP_GAP = 70 // panel sits this far above the launcher
    var saved = loadPos()
    var cur = saved && typeof saved.sidePx === 'number'
      ? { side: saved.side || side, sidePx: saved.sidePx, bottomPx: saved.bottomPx }
      : { side: side, sidePx: 20, bottomPx: 20 }
    function paint() {
      applyPos(launcher, cur.side, cur.sidePx, cur.bottomPx)
      applyPos(wrap, cur.side, cur.sidePx, cur.bottomPx + WRAP_GAP)
    }
    paint()
    // Re-clamp on resize so the widget never ends up off-screen after a
    // viewport change (rotate phone, shrink window).
    window.addEventListener('resize', function () {
      var w = launcher.offsetWidth || 56, h = launcher.offsetHeight || 56
      cur.sidePx = Math.min(Math.max(8, window.innerWidth - w - 8), Math.max(8, cur.sidePx))
      cur.bottomPx = Math.min(Math.max(8, window.innerHeight - h - 8), Math.max(8, cur.bottomPx))
      paint()
    })

    var dragging = false, moved = false, startX = 0, startY = 0, startSide = 0, startBottom = 0
    var THRESH = 5
    // Drag is MOUSE-ONLY. touch-action:none turned the launcher into a
    // scroll trap on phones: a scroll swipe starting on the button
    // wouldn't scroll the page — it flung the widget around instead (and
    // persisted the accidental position). manipulation keeps taps snappy
    // while letting the browser own pan/scroll gestures.
    launcher.style.touchAction = 'manipulation'
    launcher.addEventListener('pointerdown', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return
      if (typeof e.button === 'number' && e.button !== 0) return
      dragging = true; moved = false
      startX = e.clientX; startY = e.clientY
      startSide = cur.sidePx; startBottom = cur.bottomPx
      try { launcher.setPointerCapture(e.pointerId) } catch (_) {}
    })
    launcher.addEventListener('pointermove', function (e) {
      if (!dragging) return
      var dx = e.clientX - startX, dy = e.clientY - startY
      if (!moved && Math.abs(dx) + Math.abs(dy) > THRESH) moved = true
      if (!moved) return
      var w = launcher.offsetWidth || 56, h = launcher.offsetHeight || 56
      var maxSide = Math.max(8, window.innerWidth - w - 8)
      var maxBottom = Math.max(8, window.innerHeight - h - 8)
      var ns = cur.side === 'right' ? startSide - dx : startSide + dx
      var nb = startBottom - dy
      cur.sidePx = Math.min(maxSide, Math.max(8, ns))
      cur.bottomPx = Math.min(maxBottom, Math.max(8, nb))
      paint()
    })
    function endDrag(e) {
      if (!dragging) return
      dragging = false
      try { launcher.releasePointerCapture(e.pointerId) } catch (_) {}
      if (moved) {
        // Mark so the click handler that fires next swallows the toggle.
        launcher.__voxDragged = true
        savePos({ side: cur.side, sidePx: cur.sidePx, bottomPx: cur.bottomPx })
      }
    }
    launcher.addEventListener('pointerup', endDrag)
    launcher.addEventListener('pointercancel', endDrag)
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    })
  }
  function svgChat() {
    return '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'
  }
  function svgClose() {
    return '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
  }
  function svgPhone() {
    return '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>'
  }
  function svgMic() {
    return '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'
  }

  // ─── Visitor identity (host-supplied) ───────────────────────────────
  // Host pages that already know who the visitor is (e.g. the CRM
  // dashboard, where the app-embed script reads the logged-in user) can
  // pre-identify them so the chat never asks for name/email. Same trust
  // level as the in-chat form — convenience, never authentication.
  // If the iframe exists the identity is forwarded live via postMessage;
  // otherwise it rides along as vname/vemail when the iframe is built.
  function identityQuery() {
    var id = state.identity
    if (!id) return ''
    return (id.name ? '&vname=' + encodeURIComponent(id.name) : '')
      + (id.email ? '&vemail=' + encodeURIComponent(id.email) : '')
  }
  function pushIdentity() {
    if (!state.identity || !state.iframeWrap) return
    var frame = state.iframeWrap.querySelector('iframe')
    if (!frame || !frame.contentWindow) return
    try {
      frame.contentWindow.postMessage(
        { type: 'xovera:identify', name: state.identity.name || null, email: state.identity.email || null },
        hostUrl || '*'
      )
    } catch (_) {}
  }

  // Programmatic API for host pages
  window.Xovera = {
    open: function () { if (!state.open) toggleIframe(state.launcher, state.config && state.config.type !== 'click_to_call') },
    close: function () { if (state.open) toggleIframe(state.launcher, state.config && state.config.type !== 'click_to_call') },
    toggle: function () { toggleIframe(state.launcher, state.config && state.config.type !== 'click_to_call') },
    hide: function () { setHidden(true) },
    show: function () { setHidden(false) },
    isHidden: function () { return visHidden() },
    identify: function (info) {
      if (!info || typeof info !== 'object') return
      var name = typeof info.name === 'string' ? info.name.slice(0, 200) : null
      var email = typeof info.email === 'string' ? info.email.slice(0, 320) : null
      if (!name && !email) return
      state.identity = { name: name, email: email }
      pushIdentity()
    },
  }
})();
