/**
 * Xovera — LeadConnector sidebar switch for the chat widget
 *
 * Adds a "Chat widget" on/off switch to the bottom of the LeadConnector
 * left sidebar so staff can hide the floating widget while they work.
 * The choice is per-browser (localStorage) and is honored by widget.js
 * on every future page load until switched back on.
 *
 * Install (Agency Settings → Company → Custom Javascript, or the
 * sub-account Custom Code box), alongside the normal widget snippet:
 *
 *   var s = document.createElement('script');
 *   s.src = 'https://app.xovera.io/leadconnector-widget-toggle.js';
 *   s.async = true;
 *   document.head.appendChild(s);
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
    // The sidebar is re-rendered by the SPA router, so we look it up
    // fresh every time. Selector candidates, most-specific first.
    var host =
      document.querySelector('#sidebar-v2 nav') ||
      document.querySelector('#sidebar-v2') ||
      document.querySelector('.sidebar-v2-location') ||
      document.querySelector('aside nav')
    if (!host) return
    host.appendChild(buildRow())
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
