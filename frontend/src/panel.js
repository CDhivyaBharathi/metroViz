// Journey panel: pure functions from data to an HTML string (PLAN.md C6 panel.js). No DOM access, so every
// branch is testable with plain string asserts. All user-facing text goes through esc().

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const minutes = (m) => `≈ ${Math.round(m)} min`

// net = { lines: {id -> {name, color}}, stations: {id -> station} } built once from /api/network
export function renderJourney(j, net) {
  const line = (id) => net.lines[id] ?? { name: id, color: '#888' }
  const stops = j.legs.reduce((n, leg) => n + leg.stops, 0)
  const chips = j.lines
    .map((id) => `<span class="chip" style="--c:${esc(line(id).color)}">${esc(line(id).name)}</span>`)
    .join('')
  const steps = []
  j.legs.forEach((leg, i) => {
    steps.push(
      i === 0
        ? `<li>Board the <b>${esc(line(leg.line).name)}</b> at <b>${esc(leg.from.name)}</b></li>`
        : `<li class="change">Change at <b>${esc(leg.from.name)}</b> to the <b>${esc(line(leg.line).name)}</b></li>`,
    )
    steps.push(`<li>Ride ${plural(leg.stops, 'stop')} to <b>${esc(leg.to.name)}</b> <small>(${minutes(leg.minutes)})</small></li>`)
  })
  steps.push(`<li>Get down at <b>${esc(j.destination.name)}</b></li>`)
  return (
    `<div class="summary"><div class="ends">${esc(j.source.name)} → ${esc(j.destination.name)}</div>` +
    `<div class="stats"><span>${minutes(j.total_minutes)}</span><span>${plural(stops, 'stop')}</span>` +
    `<span>${plural(j.interchanges, 'interchange')}</span></div><div class="chips">${chips}</div></div>` +
    `<ol class="steps">${steps.join('')}</ol>` +
    renderExits(net.stations[j.destination.id])
  )
}

function renderExits(station) {
  if (!station?.exits?.length) return '' // optional field (D2): nothing rendered when absent
  const items = station.exits.map((e) => `<li><b>${esc(e.gate)}</b> ${esc(e.location)}</li>`).join('')
  return `<details class="exits"><summary>Exits at ${esc(station.name)}</summary><ul>${items}</ul></details>`
}

export const MESSAGES = {
  unknown_station: "That station isn't in the network.",
  same_station: 'Source and destination are the same station. Pick two different stations.',
  missing_param: 'Pick both a source and a destination.',
  data_unavailable: "The metro data couldn't be loaded. Check the server log and restart it.",
  network: "Couldn't reach the server. Is the backend running?",
}

export function renderError(err) {
  const text = err.code === 'no_route' ? err.message : (MESSAGES[err.code] ?? 'Something went wrong. Please try again.')
  const hint = err.suggestion ? ` Did you mean <b>${esc(err.suggestion.name)}</b>?` : ''
  return `<p class="error" role="alert">${esc(text)}${hint}</p>`
}

// Card shown at a clicked station: which slot it went into, and a button to put it in the other one.
export const renderPicker = (s, field) =>
  `<b>${esc(s.name)}</b> <small>${esc(s.code)}</small><div class="picker-actions">` +
  ['src', 'dst']
    .map((f) => `<button type="button" data-set="${f}" class="${f === field ? 'active' : ''}">${f === 'src' ? 'From' : 'To'} here${f === field ? ' ✓' : ''}</button>`)
    .join('') +
  '</div>'

export const renderLoading = () => '<p class="loading" aria-busy="true">Finding the fastest route…</p>'

export const renderHint = (blocker) => `<p class="hint">${esc(blocker ?? 'Press Find route.')}</p>`
