// Tack playground wiring.
//
// Imports the SDK from the local dist build via a relative path. Intercepts
// `fetch` so submissions resolve against a fake endpoint — the dropdown picks
// the response shape so you can exercise every FSM branch (success / 4xx /
// 5xx / 429 / network) without standing up a backend.

import { Tack, __testShadowRoots } from '../../packages/js/dist/index.mjs'

// ── Fake endpoint ───────────────────────────────────────────────────────────
//
// Tack POSTs to `${endpoint}/api/v1/feedback`. We monkey-patch `fetch` to
// intercept that exact URL and return whatever response the user picked from
// the dropdown. Other URLs pass through to the real fetch (so this page's
// own resources still load).

const FAKE_ENDPOINT = 'https://playground.tack.local'
const FEEDBACK_URL = FAKE_ENDPOINT + '/api/v1/feedback'

let pickedResponse = 'success'

const originalFetch = window.fetch.bind(window)
window.fetch = function patchedFetch(input, init) {
  const url = typeof input === 'string' ? input : input?.url ?? ''
  if (url !== FEEDBACK_URL) return originalFetch(input, init)
  // Match the FSM error branches by serving the right status + envelope.
  switch (pickedResponse) {
    case 'success':
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'fbk_' + Math.random().toString(36).slice(2, 10),
            url: 'https://tacksdk.com/inbox',
            created_at: new Date().toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    case 'rate_limited':
      return Promise.resolve(
        errorResponse(429, 'rate_limited', 'Too many requests, slow down.'),
      )
    case 'internal_error':
      return Promise.resolve(
        errorResponse(500, 'internal_error', 'Server hiccup, try again.'),
      )
    case 'invalid_request':
      return Promise.resolve(
        errorResponse(
          400,
          'invalid_request',
          'Body must be 1-5000 chars of plain text.',
        ),
      )
    case 'unauthorized':
      return Promise.resolve(
        errorResponse(401, 'unauthorized', 'Project id not recognized.'),
      )
    case 'payload_too_large':
      return Promise.resolve(
        errorResponse(413, 'payload_too_large', 'Body exceeds 5KB limit.'),
      )
    case 'network_error':
      // Throw a TypeError to mimic a real network failure.
      return Promise.reject(new TypeError('Failed to fetch'))
    default:
      return Promise.resolve(errorResponse(500, 'internal_error', 'Unknown'))
  }
}

function errorResponse(status, type, message) {
  return new Response(
    JSON.stringify({
      error: {
        type,
        message,
        doc_url: `https://tacksdk.com/docs/tack/errors/${type}`,
      },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  )
}

// ── DOM refs ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id)
const presetEl = $('preset')
const themeEl = $('theme')
const titleEl = $('title')
const placeholderEl = $('placeholder')
const submitLabelEl = $('submit-label')
const cancelLabelEl = $('cancel-label')
const accentEl = $('accent')
const accentValueEl = $('accent-value')
const accentClearEl = $('accent-clear')

// `<input type="color">` has no proper "unset" state — its value is always
// a hex string (defaults to #000000 even with value=""). To distinguish
// "user picked a color" vs "user hasn't touched it," we track the override
// status explicitly. Until the user fires `input` on the picker, the
// preset's accent stands.
let accentOverridden = false
const radiusEl = $('radius')
const radiusValueEl = $('radius-value')
const responseEl = $('response')
const resetBtn = $('reset')
const openBtn = $('open-dialog')
const openBtn2 = $('open-dialog-2')
const submitLog = $('submit-log')
const configOut = $('config-out')

// ── Submission log ──────────────────────────────────────────────────────────
const submissions = []
function logSubmission(line) {
  submissions.unshift(`${new Date().toLocaleTimeString()}  ${line}`)
  if (submissions.length > 10) submissions.pop()
  submitLog.textContent = submissions.join('\n')
}

// ── Build config from controls ──────────────────────────────────────────────
function buildConfig() {
  const config = {
    projectId: 'proj_playground',
    endpoint: FAKE_ENDPOINT,
    preset: presetEl.value,
    title: titleEl.value || undefined,
    submitLabel: submitLabelEl.value || undefined,
    cancelLabel: cancelLabelEl.value || undefined,
    placeholder: placeholderEl.value || undefined,
    onSubmit(result) {
      logSubmission(`✓ submitted: id=${result.id}`)
    },
    onError(err) {
      logSubmission(`✗ ${err.type}: ${err.message}`)
    },
    onOpen() {
      logSubmission(`→ opened`)
    },
    onClose() {
      logSubmission(`← closed`)
    },
  }
  if (themeEl.value !== 'auto') config.theme = themeEl.value
  return config
}

// Layer-3 token overrides applied directly to the dialog after mount, since
// the SDK's `preset` config doesn't expose per-token overrides yet (S3 lane
// will). We reach in via the test-only WeakMap to get the shadow root, then
// set inline custom properties on the dialog.
function applyTokenOverrides(handle) {
  // The handle doesn't expose its host element directly. We find the most
  // recently mounted host by querying the document.
  const hosts = document.querySelectorAll('tack-widget-host')
  const lastHost = hosts[hosts.length - 1]
  if (!lastHost) return
  // Closed shadow DOM means `lastHost.shadowRoot` is null. Reach in via the
  // test-only WeakMap exported by the SDK. This is the playground's only
  // production-banned escape hatch — real consumers never need it because
  // they style via the preset/Layer-2 token API, not by editing the dialog
  // element directly.
  const shadow = __testShadowRoots.get(lastHost)
  if (!shadow) return
  const dialog = shadow.querySelector('[data-tack-widget]')
  if (!dialog) return
  // Accent override — only when the user has actually picked a color.
  if (accentOverridden) {
    dialog.style.setProperty('--tack-accent', accentEl.value)
    dialog.style.setProperty('--tack-accent-strong', accentEl.value)
    dialog.style.setProperty('--tack-border-focus', accentEl.value)
  } else {
    dialog.style.removeProperty('--tack-accent')
    dialog.style.removeProperty('--tack-accent-strong')
    dialog.style.removeProperty('--tack-border-focus')
  }
  // Radius override.
  dialog.style.setProperty('--tack-radius-xl', `${radiusEl.value}px`)
}

// ── Mount management ────────────────────────────────────────────────────────
let handle = null

function remount() {
  if (handle) {
    handle.destroy()
    handle = null
  }
  const config = buildConfig()
  // The dialog isn't mounted until first open(). Token overrides have to
  // wait for the dialog DOM to exist, so we hook onOpen and apply overrides
  // on the next microtask. Wrap BEFORE init, since the SDK captures the
  // config by spread at init time — mutating it after has no effect.
  const userOnOpen = config.onOpen
  config.onOpen = () => {
    userOnOpen?.()
    queueMicrotask(() => applyTokenOverrides(handle))
  }
  configOut.textContent = serializeConfig(config)
  handle = Tack.init(config)
}

function serializeConfig(config) {
  const printable = {
    projectId: config.projectId,
    endpoint: config.endpoint,
    preset: config.preset,
    theme: config.theme,
    title: config.title,
    submitLabel: config.submitLabel,
    cancelLabel: config.cancelLabel,
    placeholder: config.placeholder,
  }
  return JSON.stringify(printable, null, 2)
}

// ── Wire controls ───────────────────────────────────────────────────────────
;[
  presetEl,
  themeEl,
  titleEl,
  placeholderEl,
  submitLabelEl,
  cancelLabelEl,
].forEach((el) => {
  el.addEventListener('change', remount)
  el.addEventListener('input', remount)
})

accentEl.addEventListener('input', () => {
  // First interaction flips the override on. Subsequent picks update the
  // value; the override stays on until the user clicks "clear."
  accentOverridden = true
  accentValueEl.textContent = `using ${accentEl.value}`
  // Rebuild so the inline override reapplies on next open. Cheaper would be
  // to set the property on the existing dialog directly, but the dialog
  // isn't mounted until first open — remount keeps the path uniform.
  remount()
})

accentClearEl.addEventListener('click', () => {
  accentOverridden = false
  accentValueEl.textContent = '(using preset accent)'
  remount()
})

radiusEl.addEventListener('input', () => {
  radiusValueEl.textContent = `${radiusEl.value}px`
  remount()
})

responseEl.addEventListener('change', () => {
  pickedResponse = responseEl.value
  logSubmission(`(next response: ${pickedResponse})`)
})

resetBtn.addEventListener('click', () => {
  presetEl.value = 'default'
  themeEl.value = 'auto'
  titleEl.value = 'Send feedback'
  placeholderEl.value = 'What can we improve?'
  submitLabelEl.value = 'Send'
  cancelLabelEl.value = 'Cancel'
  accentEl.value = '#22c55e'
  accentOverridden = false
  accentValueEl.textContent = '(using preset accent)'
  radiusEl.value = '14'
  radiusValueEl.textContent = '14px'
  responseEl.value = 'success'
  pickedResponse = 'success'
  remount()
})

openBtn.addEventListener('click', () => handle?.open())
openBtn2.addEventListener('click', () => handle?.open())

// ── Initial mount ───────────────────────────────────────────────────────────
remount()
