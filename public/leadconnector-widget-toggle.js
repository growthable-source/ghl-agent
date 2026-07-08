/**
 * Xovera — LeadConnector header switch for the chat widget
 *
 * Adds a circular hide/show button to the LeadConnector top-right header
 * controls (next to the notification / help buttons) so staff can hide
 * the floating widget while they work. Falls back to a row at the bottom
 * of the left sidebar on skins without the header controls strip.
 * The choice is per-browser (localStorage) and is honored by widget.js
 * on every future page load until switched back on.
 *
 * Install (Agency Settings → Company → Whitelabel → Custom Javascript,
 * or any Custom Code box — the field takes verbatim HTML, so include
 * the <script> tags), alongside the normal widget snippet:
 *
 *   <script src="https://app.xovera.io/widget.js"
 *           data-widget-id="wgt_xxx" data-public-key="widget_pub_xxx"
 *           async></script>
 *   <script src="https://app.xovera.io/leadconnector-widget-toggle.js" async></script>
 */
(function () {
  if (window.__xoveraMenuToggle) return
  window.__xoveraMenuToggle = true

  // Same key widget.js reads at render time — the switch works even when
  // it loads before/after the widget, or on pages without the widget.
  var KEY = 'xovera_widget_hidden'
  function isHidden() {
    try { return localStorage.getItem(KEY) === '1' } catch (_) { return false }
  }
  function setHidden(h) {
    try { h ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY) } catch (_) {}
    var api = window.Xovera
    if (api && api.hide && api.show) { h ? api.hide() : api.show() }
  }

  var ROW_ID = 'xovera-widget-toggle'

  function svgChat(slashed) {
    return '<svg width="16" height="16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">'
      + '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>'
      + (slashed ? '<line x1="3" y1="3" x2="21" y2="21" stroke-width="2.4"></line>' : '')
      + '</svg>'
  }

  // Header variant — a 32px circle matching the native header controls
  // (notification bell, help button) in the top-right strip.
  function buildHeaderButton() {
    var btn = document.createElement('button')
    btn.id = ROW_ID
    btn.type = 'button'
    btn.setAttribute('role', 'switch')
    btn.style.cssText = [
      'width:32px', 'height:32px', 'border-radius:50%', 'border:none',
      'display:inline-flex', 'align-items:center', 'justify-content:center',
      // Native header buttons carry margin-left:10px and no right margin —
      // mirror that or the strip gets a double gap on one side.
      'cursor:pointer', 'flex:none', 'margin:0 0 0 10px', 'padding:0',
      'transition:background 0.15s ease',
    ].join(';')
    function paint() {
      var on = !isHidden()
      btn.style.background = on ? '#16a34a' : '#9ca3af'
      btn.innerHTML = svgChat(!on)
      btn.title = on ? 'Hide chat widget' : 'Show chat widget'
      btn.setAttribute('aria-checked', on ? 'true' : 'false')
      btn.setAttribute('aria-label', btn.title)
    }
    btn.addEventListener('click', function () { setHidden(!isHidden()); paint() })
    paint()
    return btn
  }

  // Sidebar variant — labeled row with a pill switch, used as fallback.
  function buildRow() {
    var row = document.createElement('div')
    row.id = ROW_ID
    row.style.cssText = [
      'display:flex', 'align-items:center', 'justify-content:space-between',
      'gap:10px', 'padding:10px 16px', 'margin-top:4px',
      'font:500 13px system-ui,-apple-system,sans-serif',
      'color:inherit', 'opacity:0.85', 'cursor:pointer', 'user-select:none',
    ].join(';')

    var label = document.createElement('span')
    label.textContent = 'Chat widget'

    var track = document.createElement('span')
    track.style.cssText = [
      'position:relative', 'flex:none', 'width:34px', 'height:18px',
      'border-radius:999px', 'transition:background 0.15s ease',
    ].join(';')
    var knob = document.createElement('span')
    knob.style.cssText = [
      'position:absolute', 'top:2px', 'width:14px', 'height:14px',
      'border-radius:50%', 'background:#fff',
      'box-shadow:0 1px 3px rgba(0,0,0,0.3)', 'transition:left 0.15s ease',
    ].join(';')
    track.appendChild(knob)

    function paint() {
      var on = !isHidden() // switch shows widget VISIBILITY, so on = shown
      track.style.background = on ? '#16a34a' : '#9ca3af'
      knob.style.left = on ? '18px' : '2px'
      row.setAttribute('aria-checked', on ? 'true' : 'false')
    }
    row.setAttribute('role', 'switch')
    row.setAttribute('tabindex', '0')
    row.addEventListener('click', function () { setHidden(!isHidden()); paint() })
    row.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHidden(!isHidden()); paint() }
    })
    paint()

    row.appendChild(label)
    row.appendChild(track)
    return row
  }

  function mount() {
    if (document.getElementById(ROW_ID)) return

    // The header/sidebar are re-rendered by the SPA router, so we look
    // them up fresh every time. Header strip first — it stays visible
    // even on pages where the sidebar is collapsed, and it's a precise
    // anchor, so we mount it even on builder screens.
    var controls = document.querySelector('.hl_header--controls')
    if (controls) {
      // Sit just left of the native circle buttons (help icon if present).
      var anchor = controls.querySelector('#hl_header--help-icon') || controls.firstElementChild
      controls.insertBefore(buildHeaderButton(), anchor)
      return
    }

    // Full-screen builder apps (workflow/automation, funnels, email &
    // form builders) are a *separate stack* that replaces LC's normal
    // header + location sidebar with their own canvas chrome. They don't
    // expose a header strip, so an earlier version fell through to a
    // generic `aside nav` and dropped the full-width row into the middle
    // of the builder canvas. Bail before the sidebar fallback on those
    // screens — the stored show/hide preference still applies (widget.js
    // reads it on every load); staff just flip the switch from a normal
    // page.
    if (inFullScreenBuilder()) return

    // Sidebar fallback — LC-specific anchors ONLY. The generic
    // `aside nav` selector was removed: it matched builder side-panels
    // and mis-placed the switch. If none of these exist we're not on a
    // standard LC dashboard page, so we skip rather than guess a host.
    var host =
      document.querySelector('#sidebar-v2 nav') ||
      document.querySelector('#sidebar-v2') ||
      document.querySelector('.sidebar-v2-location')
    if (!host) return
    host.appendChild(buildRow())
  }

  // True on the LC builder/canvas takeovers. Kept broad + defensive:
  // matches the node-graph canvas (react-flow / drawflow style grids GHL
  // uses for workflows) and the builder wrappers for funnels/emails/forms.
  // Any hit means "not a standard dashboard page" → don't inject.
  function inFullScreenBuilder() {
    return !!document.querySelector(
      '.react-flow, .drawflow, [class*="workflow-builder"], [class*="builder-canvas"],' +
      ' #builder-canvas, .hl-builder, .funnel-builder, .email-builder-content'
    )
  }

  mount()

  // SPA route changes tear the sidebar down and rebuild it — watch for
  // that and re-mount. Debounced so the observer stays cheap on a busy
  // DOM.
  var pending = null
  var observer = new MutationObserver(function () {
    if (pending) return
    pending = setTimeout(function () { pending = null; mount() }, 250)
  })
  function startObserving() {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true })
    else document.addEventListener('DOMContentLoaded', function () {
      observer.observe(document.body, { childList: true, subtree: true })
      mount()
    })
  }
  startObserving()
})();
