/**
 * Voxility Chat Widget — embed loader
 *
 * Install on any website with:
 *   <script src="https://your-voxility-host.com/widget.js"
 *           data-widget-id="wgt_xxx"
 *           data-public-key="widget_pub_xxx"
 *           async></script>
 *
 * Injects a launcher button + iframe. All chat UI lives in the iframe
 * for CSS isolation.
 */
(function () {
  if (window.__voxilityLoaded) return
  window.__voxilityLoaded = true

  // Find our own script tag
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
  if (!widgetId || !publicKey) {
    console.warn('[Voxility] widget.js needs data-widget-id and data-public-key attributes')
    return
  }

  // Infer host from script src
  var hostUrl
  try { hostUrl = new URL(me.src).origin } catch (_) { hostUrl = '' }

  var state = {
    open: false,
    config: null,
    launcher: null,
    iframe: null,
    iframeWrap: null,
  }

  // Fetch config so we know colors + position before rendering
  fetch(hostUrl + '/api/widget/' + widgetId + '/config?pk=' + encodeURIComponent(publicKey))
    .then(function (r) { return r.json() })
    .then(function (cfg) {
      if (cfg && cfg.id) { state.config = cfg; render() }
    })
    .catch(function (e) { console.warn('[Voxility] config fetch failed:', e) })

  function render() {
    var cfg = state.config
    var position = cfg.position === 'bottom-left' ? 'left' : 'right'

    // Launcher button
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
    btn.innerHTML = chatIcon()
    btn.onmouseenter = function () { btn.style.transform = 'scale(1.05)' }
    btn.onmouseleave = function () { btn.style.transform = 'scale(1)' }
    btn.onclick = toggle
    document.body.appendChild(btn)
    state.launcher = btn

    // Iframe wrapper (starts hidden)
    var wrap = document.createElement('div')
    wrap.style.cssText = [
      'position:fixed', 'bottom:90px', position + ':20px',
      'width:min(380px,calc(100vw - 40px))',
      'height:min(620px,calc(100vh - 120px))',
      'border-radius:16px', 'overflow:hidden',
      'box-shadow:0 12px 40px rgba(0,0,0,0.25)',
      'z-index:2147483647', 'display:none',
      'background:#09090b',
      'border:1px solid #27272a',
      'transition:opacity 0.2s ease, transform 0.2s ease',
      'opacity:0', 'transform:translateY(12px)',
    ].join(';')
    var iframe = document.createElement('iframe')
    iframe.src = hostUrl + '/widget/' + widgetId + '/embed?pk=' + encodeURIComponent(publicKey)
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#09090b'
    iframe.setAttribute('title', cfg.title || 'Chat')
    iframe.setAttribute('allow', 'microphone')
    wrap.appendChild(iframe)
    document.body.appendChild(wrap)
    state.iframe = iframe
    state.iframeWrap = wrap
  }

  function toggle() {
    state.open = !state.open
    if (state.open) {
      state.iframeWrap.style.display = 'block'
      // Let display flush, then transition in
      requestAnimationFrame(function () {
        state.iframeWrap.style.opacity = '1'
        state.iframeWrap.style.transform = 'translateY(0)'
      })
      state.launcher.innerHTML = closeIcon()
    } else {
      state.iframeWrap.style.opacity = '0'
      state.iframeWrap.style.transform = 'translateY(12px)'
      setTimeout(function () {
        if (!state.open) state.iframeWrap.style.display = 'none'
      }, 220)
      state.launcher.innerHTML = chatIcon()
    }
  }

  function chatIcon() {
    return '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'
  }
  function closeIcon() {
    return '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
  }

  // Expose a tiny API for sites to open/close programmatically
  window.Voxility = {
    open: function () { if (!state.open) toggle() },
    close: function () { if (state.open) toggle() },
    toggle: toggle,
  }
})();
