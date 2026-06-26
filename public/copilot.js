/**
 * Xovera Co-Pilot embed — drop a live screen-share agent into any app.
 *
 *   <script src="https://app.xovera.io/copilot.js"
 *           data-copilot-key="cpa_..." async></script>
 *
 * Renders a launch button (bottom-right by default) that opens the
 * agent's session page in a new tab — a tab we own, so screen-share
 * permission prompts always work regardless of the host page's iframe
 * policies. Programmatic API for custom buttons:
 *
 *   window.XoveraCopilot.launch()        // open the session
 *   window.XoveraCopilot.url             // the launch URL
 *
 * data- options: data-label="Get live help"  data-position="bottom-left"
 *                data-color="#e84425"        data-hide-button="true"
 */
;(function () {
  var script = document.currentScript
  if (!script) return
  var key = script.getAttribute('data-copilot-key')
  if (!key) {
    console.warn('[xovera-copilot] missing data-copilot-key')
    return
  }
  var base = new URL(script.src).origin
  var url = base + '/copilot/live/' + encodeURIComponent(key)

  function launch() {
    window.open(url, '_blank', 'noopener')
  }

  window.XoveraCopilot = { launch: launch, url: url }

  if (script.getAttribute('data-hide-button') === 'true') return

  var label = script.getAttribute('data-label') || 'Get live help'
  var color = script.getAttribute('data-color') || '#e84425'
  var position = script.getAttribute('data-position') || 'bottom-right'

  var btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label
  btn.setAttribute('aria-label', label)
  btn.style.cssText =
    'position:fixed;z-index:2147483646;padding:12px 20px;border:none;border-radius:9999px;' +
    'background:' + color + ';color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer;' +
    'box-shadow:0 8px 30px rgba(0,0,0,.25);' +
    (position === 'bottom-left' ? 'left:20px;' : 'right:20px;') + 'bottom:20px;'
  btn.addEventListener('click', launch)

  if (document.body) document.body.appendChild(btn)
  else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(btn) })
})()
