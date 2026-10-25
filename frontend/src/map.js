// SVG network map (PLAN.md C6 map.js). The network is drawn once; pan and zoom only move the viewBox, and a route
// is shown by toggling CSS classes, so the DOM never changes size after the first draw.
import { esc } from './panel.js'

const NS = 'http://www.w3.org/2000/svg'
const PAD = 40 // svg units of margin around the network in the fit view
export const FIT_ZOOM = 3 // the default view shows the centre of the network at 3× so every label has room
export const MIN_ZOOM = 1 / FIT_ZOOM // … and zooming all the way out is exactly the whole network
export const MAX_ZOOM = 12 // relative to the default view. Labels (station codes) are always drawn.
export const DRAG_PX = 3 // pointer travel below this still counts as a click

export function createMap(svg, network, { onPick, tooltip, basemap } = {}) {
  const stations = Object.fromEntries(network.stations.map((s) => [s.id, s]))
  const lines = Object.fromEntries(network.lines.map((l) => [l.id, l]))
  const color = (id) => lines[id]?.color ?? '#888'
  const full = { w: Math.max(...network.stations.map((s) => s.x)) + 2 * PAD, h: Math.max(...network.stations.map((s) => s.y)) + 2 * PAD }
  const fitBox = { w: full.w / FIT_ZOOM, h: full.h / FIT_ZOOM }
  fitBox.x = -PAD + (full.w - fitBox.w) / 2
  fitBox.y = -PAD + (full.h - fitBox.h) / 2
  let box = { ...fitBox }

  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag)
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
    parent.append(n)
    return n
  }

  // --- static draw ---------------------------------------------------------------------------
  svg.replaceChildren()
  const gBase = el('g', { class: 'basemap' }, svg) // OSM tiles already placed in station units by data/build_basemap.py
  for (const t of basemap?.tiles ?? []) {
    el('image', { href: t.src, x: t.x, y: t.y, width: t.w, height: t.h, preserveAspectRatio: 'none' }, gBase)
  }
  const gEdges = el('g', { class: 'edges' }, svg)
  const gStations = el('g', { class: 'stations' }, svg)
  const edgeEls = {}
  for (const e of network.edges) {
    const a = stations[e.a]
    const b = stations[e.b]
    edgeEls[edgeKey(e.a, e.b, e.line)] = el(
      'line',
      { class: 'edge', x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color(e.line), 'data-line': e.line },
      gEdges,
    )
  }
  const stationEls = {}
  let dragged = false
  for (const s of network.stations) {
    const g = el(
      'g',
      { class: 'station' + (s.is_interchange ? ' interchange' : ''), 'data-id': s.id, transform: `translate(${s.x} ${s.y})` },
      gStations,
    )
    el('circle', { r: s.is_interchange ? 5.5 : 3.5, fill: s.is_interchange ? '#fff' : color(s.lines[0]) }, g)
    el('text', { x: 8, y: 3 }, g).textContent = s.code // the full name is in the tooltip
    g.addEventListener('click', (ev) => !dragged && onPick?.(s, ev))
    g.addEventListener('pointerenter', (ev) => showTip(s, ev))
    g.addEventListener('pointerleave', hideTip)
    stationEls[s.id] = g
  }

  function showTip(s, ev) {
    if (!tooltip) return
    const names = s.lines.map((id) => lines[id]?.name ?? id).join(', ')
    tooltip.innerHTML = `<b>${esc(s.name)}</b> <small>${esc(s.code)}</small><br>${esc(names)}${s.is_interchange ? '<br><i>Interchange</i>' : ''}`
    tooltip.style.left = `${ev.clientX + 14}px`
    tooltip.style.top = `${ev.clientY + 14}px`
    tooltip.hidden = false
  }
  function hideTip() {
    if (tooltip) tooltip.hidden = true
  }

  // --- route highlight ------------------------------------------------------------------------
  function clearHighlight() {
    svg.classList.remove('has-route')
    svg.querySelectorAll('.on-route, .change').forEach((n) => n.classList.remove('on-route', 'change'))
  }
  function highlight(journey) {
    clearHighlight()
    svg.classList.add('has-route')
    for (const leg of journey.legs) {
      for (let i = 0; i + 1 < leg.station_ids.length; i++) {
        edgeEls[edgeKey(leg.station_ids[i], leg.station_ids[i + 1], leg.line)]?.classList.add('on-route')
      }
    }
    for (const id of journey.station_ids) stationEls[id]?.classList.add('on-route')
    for (const leg of journey.legs.slice(1)) stationEls[leg.from.id]?.classList.add('change')
  }
  function setEndpoints(srcId, dstId) {
    svg.querySelectorAll('.src, .dst').forEach((n) => n.classList.remove('src', 'dst'))
    stationEls[srcId]?.classList.add('src')
    stationEls[dstId]?.classList.add('dst')
  }

  // --- pan and zoom (viewBox only) --------------------------------------------------------------
  const zoom = () => fitBox.w / box.w
  function apply() {
    svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`)
  }
  function zoomBy(factor, cx = box.x + box.w / 2, cy = box.y + box.h / 2) {
    // (cx, cy) in svg units stays under the cursor
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom() * factor))
    const w = fitBox.w / z
    const h = fitBox.h / z
    box = { x: cx - ((cx - box.x) * w) / box.w, y: cy - ((cy - box.y) * h) / box.h, w, h }
    apply()
  }
  function fit() {
    box = { ...fitBox }
    apply()
  }
  function unitsPerPixel() {
    const r = svg.getBoundingClientRect()
    return Math.max(box.w / r.width, box.h / r.height) // preserveAspectRatio 'meet': one scale, letterboxed
  }
  function toSvg(clientX, clientY) {
    const r = svg.getBoundingClientRect()
    const s = unitsPerPixel()
    return [box.x - (r.width * s - box.w) / 2 + (clientX - r.left) * s, box.y - (r.height * s - box.h) / 2 + (clientY - r.top) * s]
  }

  svg.addEventListener('wheel', (e) => {
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 1.25 : 0.8, ...toSvg(e.clientX, e.clientY))
  }, { passive: false })

  const pointers = new Map() // pointerId -> [clientX, clientY]; one = drag, two = pinch
  let downAt = [0, 0]
  // No setPointerCapture here: with capture, browsers retarget the click to the svg, so station clicks never fire.
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY])
    downAt = [e.clientX, e.clientY]
    dragged = false
  })
  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return
    const [px, py] = pointers.get(e.pointerId)
    if (pointers.size === 1) {
      const s = unitsPerPixel()
      box.x -= (e.clientX - px) * s
      box.y -= (e.clientY - py) * s
      apply()
    } else {
      const [[ax, ay], [bx, by]] = [...pointers.values()]
      const before = Math.hypot(ax - bx, ay - by)
      pointers.set(e.pointerId, [e.clientX, e.clientY])
      const [[cx, cy], [dx, dy]] = [...pointers.values()]
      zoomBy(Math.hypot(cx - dx, cy - dy) / before || 1, ...toSvg((cx + dx) / 2, (cy + dy) / 2))
    }
    pointers.set(e.pointerId, [e.clientX, e.clientY])
    if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > DRAG_PX) dragged = true // trackpad jitter is still a click
  })
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    svg.addEventListener(type, (e) => pointers.delete(e.pointerId))
  }

  fit()
  return {
    highlight,
    clearHighlight,
    setEndpoints,
    fit,
    zoomIn: () => zoomBy(1.5),
    zoomOut: () => zoomBy(1 / 1.5),
    zoom,
    box: () => ({ ...box }),
  }
}

// Shared tracks (Anand Vihar–Karkarduma on BLUE_BR and PINK) are two <line>s; the leg's line picks the right one.
export const edgeKey = (a, b, line) => (a < b ? `${a}|${b}|${line}` : `${b}|${a}|${line}`)

export const renderLegend = (lines) =>
  lines.map((l) => `<span class="legend-item"><i style="background:${esc(l.color)}"></i>${esc(l.name)}</span>`).join('')
