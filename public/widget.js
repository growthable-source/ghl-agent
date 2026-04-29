/**
 * Voxility Widget — embed loader
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
 *   <div id="voxility-call"></div>
 *   <script src="…/widget.js"
 *           data-widget-id="wgt_xxx"
 *           data-public-key="widget_pub_xxx"
 *           data-mount="#voxility-call"
 *           async></script>
 */
(function () {
  if (window.__voxilityLoaded) return
  window.__voxilityLoaded = true

  var me = document.currentScript
  if (!me) {
    var scripts = document.getElementsByTagName('script')
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf('widget.js') !== -1) { me = scripts[i]; break }
    }
  }
  if (!me) { console.warn('[Voxility] Could not find widget script tag'); return }

  var widgetId = me.getAttribute('data-widget-id') || me.getAttribute('data-key')
  var publicKey = me.getAttribute('data-public-key') || me.getAttribute('data-pk')
  var mountSelector = me.getAttribute('data-mount')
  if (!widgetId || !publicKey) {
    console.warn('[Voxility] widget.js needs data-widget-id and data-public-key attributes')
    return
  }

  var hostUrl
  try { hostUrl = new URL(me.src).origin } catch (_) { hostUrl = '' }

  var state = {
    open: false,
    config: null,
    launcher: null,
    iframe: null,
    iframeWrap: null,
  }

  fetch(hostUrl + '/api/widget/' + widgetId + '/config?pk=' + encodeURIComponent(publicKey))
    .then(function (r) { return r.json() })
    .then(function (cfg) {
      if (cfg && cfg.id) { state.config = cfg; render(); startVisitorTracking() }
    })
    .catch(function (e) { console.warn('[Voxility] config fetch failed:', e) })

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
      // sendBeacon is fire-and-forget and survives page unload — perfect
      // for the "user navigated away" case. Falls back to fetch when
      // unsupported (older Safari) or when the body type fails.
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' })
        if (navigator.sendBeacon(url, blob)) return
      }
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true })
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
    btn.onclick = function () { toggleIframe(btn, true) }
    document.body.appendChild(btn)
    state.launcher = btn

    var wrap = buildIframe(hostUrl + '/widget/' + widgetId + '/embed?pk=' + encodeURIComponent(publicKey), cfg.title || 'Chat', position, false)
    document.body.appendChild(wrap)
    state.iframeWrap = wrap
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
    btn.onclick = function () { toggleIframe(btn, false) }

    if (floating) {
      document.body.appendChild(btn)
    } else {
      var mount = mountSelector ? document.querySelector(mountSelector) : null
      if (!mount) {
        console.warn('[Voxility] inline mount target not found:', mountSelector || '#voxility-call')
        return
      }
      mount.appendChild(btn)
    }
    state.launcher = btn

    var wrap = buildIframe(hostUrl + '/widget/' + widgetId + '/call?pk=' + encodeURIComponent(publicKey), cfg.buttonLabel || 'Call', position, true)
    document.body.appendChild(wrap)
    state.iframeWrap = wrap
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
      requestAnimationFrame(function () {
        state.iframeWrap.style.opacity = '1'
        state.iframeWrap.style.transform = 'translateY(0)'
      })
      if (swapIcon && launcher) launcher.innerHTML = svgClose()
    } else {
      state.iframeWrap.style.opacity = '0'
      state.iframeWrap.style.transform = 'translateY(12px)'
      setTimeout(function () { if (!state.open) state.iframeWrap.style.display = 'none' }, 220)
      if (swapIcon && launcher) launcher.innerHTML = svgChat()
    }
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

  // Programmatic API for host pages
  window.Voxility = {
    open: function () { if (!state.open) toggleIframe(state.launcher, state.config && state.config.type !== 'click_to_call') },
    close: function () { if (state.open) toggleIframe(state.launcher, state.config && state.config.type !== 'click_to_call') },
    toggle: function () { toggleIframe(state.launcher, state.config && state.config.type !== 'click_to_call') },
  }
})();
