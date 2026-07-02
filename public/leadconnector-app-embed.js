/**
 * Xovera app-embed — the Custom JS file registered on the marketplace
 * app (Marketplace → app → Custom JS module → this file's URL:
 * https://app.xovera.io/leadconnector-app-embed.js).
 *
 * The CRM injects this into the dashboard for every account that
 * installed the app. It replaces the copy-paste "CRM dashboard install"
 * snippet with a zero-config flow:
 *
 *   1. Wait for the platform's AppUtils global (Custom JS runtime API).
 *   2. Resolve the active sub-account → ask our backend which widget
 *      serves it (AgencyConnection mapping). Location toggled off, or
 *      no connected widget → render nothing (per-location kill switch).
 *   3. Inject widget.js (with data-location-id) + the hide/show
 *      sidebar toggle.
 *   4. Pre-identify the chat with the logged-in user's name/email via
 *      Xovera.identify() — staff never see the who-are-you form.
 *
 * Identity from AppUtils is client-side and therefore only ever used
 * as conversation prefill — never authentication.
 */
(function () {
  if (window.__xoveraAppEmbed) return
  window.__xoveraAppEmbed = true

  // Derive our origin from this script's own src so whitelabel/staging
  // deployments don't need an edited copy. Fallback: production.
  var HOST = 'https://app.xovera.io'
  try {
    var me = document.currentScript
    if (!me) {
      var scripts = document.getElementsByTagName('script')
      for (var i = 0; i < scripts.length; i++) {
        if (scripts[i].src && scripts[i].src.indexOf('leadconnector-app-embed.js') !== -1) { me = scripts[i]; break }
      }
    }
    if (me && me.src) HOST = new URL(me.src).origin
  } catch (_) {}

  var loadedForLocation = null

  // Docs examples namespace the context API under AppUtils.Utilities
  // (getCurrentUser/getCurrentLocation/getCompany). Fall back to a flat
  // AppUtils shape defensively in case the runtime exposes both.
  function utils() {
    var a = window.AppUtils
    if (!a) return null
    if (a.Utilities && typeof a.Utilities.getCurrentLocation === 'function') return a.Utilities
    if (typeof a.getCurrentLocation === 'function') return a
    return null
  }

  function waitForAppUtils(attempt) {
    attempt = attempt || 0
    if (utils()) { boot(); return }
    if (attempt > 60) return // ~30s — not a Custom JS context after all
    setTimeout(function () { waitForAppUtils(attempt + 1) }, 500)
  }

  function boot() {
    resolveAndMount()
    // Sub-account switches are SPA route changes — remount for the new
    // location (or hide if the new one is toggled off).
    try {
      window.addEventListener('routeChangeEvent', function () { resolveAndMount() })
    } catch (_) {}
  }

  function resolveAndMount() {
    Promise.resolve(utils().getCurrentLocation())
      .then(function (loc) {
        var locationId = loc && loc.id
        if (!locationId || locationId === loadedForLocation) return
        return fetch(HOST + '/api/leadconnector-embed/resolve?locationId=' + encodeURIComponent(locationId))
          .then(function (r) { return r.json() })
          .then(function (data) {
            if (!data || !data.widget) {
              // Toggled off / not connected. If a widget from a previous
              // sub-account is on screen, hide it.
              if (loadedForLocation && window.Xovera) window.Xovera.hide()
              return
            }
            if (loadedForLocation) {
              // widget.js guards against double-load; a different widget
              // per sub-account needs a reload we can't do from here.
              // Same widget, new location: just make sure it's visible.
              if (window.Xovera) window.Xovera.show()
              identify()
              return
            }
            loadedForLocation = locationId
            mount(data.widget, locationId)
          })
      })
      .catch(function (e) { console.warn('[Xovera app-embed] resolve failed:', e && e.message) })
  }

  function mount(widget, locationId) {
    var s = document.createElement('script')
    s.src = HOST + '/widget.js'
    s.async = true
    s.setAttribute('data-widget-id', widget.id)
    s.setAttribute('data-public-key', widget.publicKey)
    s.setAttribute('data-location-id', locationId)
    s.onload = identify
    document.body.appendChild(s)

    // Hide/show switch in the CRM sidebar (per-browser preference).
    var t = document.createElement('script')
    t.src = HOST + '/leadconnector-widget-toggle.js'
    t.async = true
    document.body.appendChild(t)
  }

  function identify(attempt) {
    attempt = attempt || 0
    if (!window.Xovera || typeof window.Xovera.identify !== 'function') {
      if (attempt > 20) return
      setTimeout(function () { identify(attempt + 1) }, 500)
      return
    }
    Promise.resolve(utils().getCurrentUser())
      .then(function (u) {
        if (!u) return
        var name = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ')
        if (name || u.email) window.Xovera.identify({ name: name || null, email: u.email || null })
      })
      .catch(function () {})
  }

  waitForAppUtils()
})();
