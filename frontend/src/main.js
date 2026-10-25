// Wiring only (PLAN.md C6 main.js): store ↔ map ↔ comboboxes ↔ panel. All logic lives in the imported modules.
import './style.css'
import * as api from './api.js'
import { createStore } from './state.js'
import { createMap, renderLegend } from './map.js'
import { createCombobox } from './search.js'
import basemap from './basemap.json'
import { renderJourney, renderError, renderLoading, renderHint, renderPicker } from './panel.js'

const $ = (sel) => document.querySelector(sel)
const store = createStore(api)
const panel = $('#panel')

async function init() {
  let network
  try {
    network = await api.fetchNetwork()
  } catch (e) {
    panel.innerHTML = renderError(e) // ER1: 503 or no server → "couldn't load data", nothing else to do
    return
  }
  const net = {
    lines: Object.fromEntries(network.lines.map((l) => [l.id, l])),
    stations: Object.fromEntries(network.stations.map((s) => [s.id, s])),
  }
  const map = createMap($('#map'), network, { tooltip: $('#tooltip'), onPick: pickFromMap, basemap })
  $('#legend').innerHTML = renderLegend(network.lines)

  const combo = {}
  let activeField = 'src'
  for (const field of ['src', 'dst']) {
    const input = $(`#${field}`)
    input.addEventListener('focus', () => (activeField = field))
    combo[field] = createCombobox({
      input,
      list: $(`#${field}-list`),
      clearButton: $(`#${field}-clear`),
      search: (q) => api.searchStations(q),
      stations: network.stations,
      onSelect: (s) => (field === 'src' ? store.setSrc(s) : store.setDst(s)),
    })
  }

  const picker = $('#picker')
  let picked = null // station under the open picker card
  function setField(field, s) {
    combo[field].setValue(s)
    field === 'src' ? store.setSrc(s) : store.setDst(s)
  }
  function pickFromMap(s, ev) {
    const { src, dst } = store.get()
    const field = !src ? 'src' : !dst ? 'dst' : activeField // fill the empty slot first, then whichever was focused
    setField(field, s)
    picked = s
    picker.innerHTML = renderPicker(s, field)
    const wrap = picker.parentElement.getBoundingClientRect()
    picker.style.left = `${ev.clientX - wrap.left + 12}px`
    picker.style.top = `${ev.clientY - wrap.top + 12}px`
    picker.hidden = false
  }
  picker.addEventListener('click', (e) => {
    const b = e.target.closest('[data-set]')
    if (!b) return
    const other = b.dataset.set === 'src' ? 'dst' : 'src'
    if (store.get()[other]?.id === picked.id) setField(other, null) // the button means "move it", not "duplicate it"
    setField(b.dataset.set, picked)
    picker.innerHTML = renderPicker(picked, b.dataset.set)
  })
  document.addEventListener('pointerdown', (e) => !picker.contains(e.target) && (picker.hidden = true))
  document.addEventListener('keydown', (e) => e.key === 'Escape' && (picker.hidden = true))

  $('#form').addEventListener('submit', (e) => {
    e.preventDefault()
    store.find()
  })
  $('#swap').addEventListener('click', () => {
    store.swap()
    combo.src.setValue(store.get().src)
    combo.dst.setValue(store.get().dst)
  })
  $('#reset').addEventListener('click', () => {
    store.reset()
    picker.hidden = true
    combo.src.setValue(null)
    combo.dst.setValue(null)
    map.fit()
    $('#src').focus()
  })
  $('#zoom-in').addEventListener('click', map.zoomIn)
  $('#zoom-out').addEventListener('click', map.zoomOut)
  $('#fit').addEventListener('click', map.fit)

  store.subscribe((state) => {
    const find = $('#find')
    find.disabled = !store.canFind()
    find.title = store.blocker() ?? ''
    map.setEndpoints(state.src?.id, state.dst?.id)
    if (state.status === 'ready') {
      map.highlight(state.journey)
      panel.innerHTML = renderJourney(state.journey, net)
    } else {
      map.clearHighlight()
      panel.innerHTML = state.status === 'loading' ? renderLoading() : state.status === 'error' ? renderError(state.error) : renderHint(store.blocker())
    }
  })
  store.reset()
}

init()
