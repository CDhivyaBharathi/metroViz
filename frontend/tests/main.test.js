// System-level happy path (PLAN.md C7) in jsdom: real index.html, real modules, fake fetch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NETWORK, JOURNEY_1, jsonResponse } from './fixtures.js'
import basemap from '../src/basemap.json'

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8')
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'))
const tick = () => new Promise((r) => setTimeout(r, 0))
const $ = (s) => document.querySelector(s)

function fakeFetch(overrides = {}) {
  return vi.fn(async (url) => {
    if (url.startsWith('/api/network')) return overrides.network ?? jsonResponse(NETWORK)
    if (url.startsWith('/api/route')) return overrides.route ?? jsonResponse(JOURNEY_1)
    if (url.startsWith('/api/search')) return jsonResponse({ results: [NETWORK.stations[0]] })
    throw new Error('unexpected ' + url)
  })
}

async function boot(overrides) {
  document.body.innerHTML = body
  vi.stubGlobal('fetch', fakeFetch(overrides))
  vi.resetModules()
  await import('../src/main.js')
  await tick()
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.useRealTimers())

describe('main.js wiring', () => {
  it('draws the map and legend, Find starts disabled with a reason', async () => {
    await boot()
    expect(document.querySelectorAll('#map .station')).toHaveLength(9)
    expect(document.querySelectorAll('#map .basemap image')).toHaveLength(basemap.tiles.length) // the real OSM tiles
    expect($('#legend').textContent).toContain('Red Line')
    expect($('#find').disabled).toBe(true)
    expect($('#find').title).toBe('Pick a source station')
    expect($('#panel').textContent).toBe('Pick a source station')
  })

  it('pick two stations on the map → Find → route shown and highlighted → Reset clears (≤ 4 actions)', async () => {
    await boot()
    const click = (id) => $(`#map .station[data-id="${id}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    click('a') // 1
    expect($('#src').value).toBe('Alpha')
    expect($('#find').title).toBe('Pick a destination station')
    click('d') // 2: the empty slot is filled next
    expect($('#dst').value).toBe('Delta <&>')
    expect($('#find').disabled).toBe(false)
    $('#form').dispatchEvent(new Event('submit', { cancelable: true })) // 3
    expect($('#panel').textContent).toContain('Finding the fastest route')
    await tick()
    expect(fetch).toHaveBeenCalledWith('/api/route?src=a&dst=d', expect.anything())
    expect($('#panel').textContent).toContain('Board the Yellow Line at Alpha')
    expect($('#map').classList.contains('has-route')).toBe(true)
    expect(document.querySelectorAll('#map .station.on-route')).toHaveLength(4)
    $('#reset').click() // 4
    expect([$('#src').value, $('#dst').value]).toEqual(['', ''])
    expect($('#map').classList.contains('has-route')).toBe(false)
    expect($('#panel').textContent).toBe('Pick a source station')
    expect($('#map').getAttribute('viewBox').split(' ').map(Math.round)).toEqual([320, 253, 360, 293])
  })

  it('clicking a station opens the picker card; its buttons move the station between From and To', async () => {
    await boot()
    const click = (id) => $(`#map .station[data-id="${id}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 300, clientY: 200 }))
    expect($('#picker').hidden).toBe(true)
    click('a')
    expect($('#picker').hidden).toBe(false)
    expect($('#picker').textContent).toContain('Alpha')
    expect($('#picker .active').dataset.set).toBe('src')
    expect($('#picker').style.left).toBe('312px')
    $('#picker [data-set="dst"]').click() // move it: Alpha becomes the destination, From is emptied
    expect([$('#src').value, $('#dst').value]).toEqual(['', 'Alpha'])
    expect($('#picker .active').dataset.set).toBe('dst')
    expect($('#map .station.dst').dataset.id).toBe('a')
    $('#picker').click() // clicking the card background does nothing
    expect($('#dst').value).toBe('Alpha')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect($('#picker').hidden).toBe(true)
    click('b')
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) // click elsewhere closes it
    expect($('#picker').hidden).toBe(true)
    click('c')
    $('#picker').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) // but not a click inside it
    expect($('#picker').hidden).toBe(false)
    $('#reset').click()
    expect($('#picker').hidden).toBe(true)
  })

  it('a later map click replaces the focused field; swap exchanges them', async () => {
    await boot()
    const click = (id) => $(`#map .station[data-id="${id}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    click('a')
    click('d')
    $('#src').dispatchEvent(new Event('focus'))
    expect($('#src-list').hidden).toBe(true) // a filled box does not drop the A→Z list
    click('b')
    expect([$('#src').value, $('#dst').value]).toEqual(['Bravo', 'Delta <&>'])
    $('#swap').click()
    expect([$('#src').value, $('#dst').value]).toEqual(['Delta <&>', 'Bravo'])
    expect($('#map .station.src').dataset.id).toBe('d')
  })

  it('picking by name through the combobox works and the same station is blocked (ER3)', async () => {
    await boot()
    vi.useFakeTimers() // after boot: boot's tick() needs real timers
    $('#src').value = 'alp'
    $('#src').dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(200)
    $('#src').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect($('#src').value).toBe('Alpha')
    $('#map .station[data-id="a"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect($('#find').disabled).toBe(true)
    expect($('#find').title).toBe('Pick two different stations')
  })

  it('shows the API error in the panel and clears the highlight (ER5)', async () => {
    await boot({ route: jsonResponse({ error: { code: 'no_route', message: 'No route between Alpha and Hotel' } }, 404) })
    $('#map .station[data-id="a"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    $('#map .station[data-id="h"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    $('#form').dispatchEvent(new Event('submit', { cancelable: true }))
    await tick()
    expect($('#panel .error').textContent).toBe('No route between Alpha and Hotel')
    expect($('#map').classList.contains('has-route')).toBe(false)
  })

  it('shows "data could not be loaded" when /network is 503 (ER1)', async () => {
    await boot({ network: jsonResponse({ error: { code: 'data_unavailable', message: 'x' } }, 503) })
    expect($('#panel .error').textContent).toContain("couldn't be loaded")
    expect(document.querySelectorAll('#map .station')).toHaveLength(0)
  })

  it('map buttons zoom and fit', async () => {
    await boot()
    $('#zoom-in').click()
    expect($('#map').getAttribute('viewBox')).not.toBe('-40 -40 1080 880')
    $('#zoom-out').click()
    $('#zoom-in').click()
    $('#fit').click()
    expect($('#map').getAttribute('viewBox').split(' ').map(Math.round)).toEqual([320, 253, 360, 293])
  })
})
