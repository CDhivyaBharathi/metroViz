import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMap, edgeKey, renderLegend, MIN_ZOOM, MAX_ZOOM, FIT_ZOOM, DRAG_PX } from '../src/map.js'
import { NETWORK, JOURNEY_1 } from './fixtures.js'

let svg, tooltip, onPick, map

beforeEach(() => {
  document.body.innerHTML = '<svg id="map"></svg><div id="tooltip" hidden></div>'
  svg = document.querySelector('svg')
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 540, height: 540 }) // jsdom has no layout
  tooltip = document.querySelector('#tooltip')
  onPick = vi.fn()
  map = createMap(svg, NETWORK, { onPick, tooltip })
})

const ids = (sel) => [...svg.querySelectorAll(sel)].map((n) => n.dataset.id).sort()
const box = () => svg.getAttribute('viewBox').split(' ').map(Number)

describe('static draw', () => {
  it('draws one element per station and per edge', () => {
    expect(svg.querySelectorAll('.station')).toHaveLength(NETWORK.stations.length)
    expect(svg.querySelectorAll('.edge')).toHaveLength(NETWORK.edges.length)
    expect(svg.querySelectorAll('.station text')).toHaveLength(NETWORK.stations.length)
  })

  it('marks exactly the interchange set', () => {
    expect(ids('.station.interchange')).toEqual(['a', 'c'])
  })

  it('colours edges by line and places stations at their x/y', () => {
    const ab = svg.querySelector('.edge[data-line="RED"]')
    expect([ab.getAttribute('x1'), ab.getAttribute('y1'), ab.getAttribute('x2'), ab.getAttribute('y2'), ab.getAttribute('stroke')]).toEqual(['0', '500', '200', '500', '#FF4040'])
    expect(svg.querySelector('.station[data-id="g"]').getAttribute('transform')).toBe('translate(200 400)')
  })

  it('starts at the default view: the centre of the network at FIT_ZOOM, every label drawn as the code', () => {
    // whole network is [-40, -40, 1080, 880]; at 3× the box is a third as wide and high, centred on (500, 400)
    expect(FIT_ZOOM).toBe(3)
    expect(box().map(Math.round)).toEqual([320, 253, 360, 293])
    expect(map.zoom()).toBe(1)
    expect([...svg.querySelectorAll('.station text')].map((t) => t.textContent)).toEqual(NETWORK.stations.map((s) => s.code))
  })

  it('draws one <image> per basemap tile behind the edges, none without a basemap', () => {
    expect(svg.querySelectorAll('image')).toHaveLength(0)
    createMap(svg, NETWORK, { basemap: { tiles: [{ src: '/tiles/t.png', x: -10, y: -20, w: 300, h: 250 }] } })
    const img = svg.querySelector('image')
    expect(svg.firstElementChild.classList.contains('basemap')).toBe(true)
    expect([img.getAttribute('href'), img.getAttribute('x'), img.getAttribute('y'), img.getAttribute('width'), img.getAttribute('height'), img.getAttribute('preserveAspectRatio')]).toEqual(['/tiles/t.png', '-10', '-20', '300', '250', 'none'])
  })

  it('renders a legend entry per line', () => {
    const html = renderLegend(NETWORK.lines)
    expect(html.match(/legend-item/g)).toHaveLength(4)
    expect(html).toContain('background:#4169E1"></i>Blue Line')
  })
})

describe('highlight', () => {
  it('marks exactly the route stations and the leg edges, including the right line on a shared track', () => {
    map.highlight(JOURNEY_1)
    expect(svg.classList.contains('has-route')).toBe(true)
    expect(ids('.station.on-route')).toEqual(['a', 'c', 'd', 'g'])
    const onRoute = [...svg.querySelectorAll('.edge.on-route')].map((e) => e.dataset.line + ':' + e.getAttribute('x1') + '-' + e.getAttribute('x2'))
    expect(onRoute.sort()).toEqual(['RED:400-600', 'YELLOW:0-200', 'YELLOW:200-400']) // not YELLOW c–d, which shares the track
    expect(ids('.station.change')).toEqual(['c'])
  })

  it('clearHighlight restores everything', () => {
    map.highlight(JOURNEY_1)
    map.clearHighlight()
    expect(svg.classList.contains('has-route')).toBe(false)
    expect(svg.querySelectorAll('.on-route, .change')).toHaveLength(0)
  })

  it('setEndpoints marks src and dst and moves with new picks', () => {
    map.setEndpoints('a', 'd')
    expect([ids('.station.src'), ids('.station.dst')]).toEqual([['a'], ['d']])
    map.setEndpoints('b', undefined)
    expect([ids('.station.src'), ids('.station.dst')]).toEqual([['b'], []])
  })

  it('ignores ids that are not on the map', () => {
    expect(() => map.highlight({ ...JOURNEY_1, station_ids: ['nope'], legs: [{ line: 'X', from: { id: 'q' }, station_ids: ['q', 'r'] }, { line: 'Y', from: { id: 'q' }, station_ids: ['r', 's'] }] })).not.toThrow()
  })

  it('edgeKey is symmetric and line-specific', () => {
    expect(edgeKey('c', 'd', 'RED')).toBe(edgeKey('d', 'c', 'RED'))
    expect(edgeKey('c', 'd', 'RED')).not.toBe(edgeKey('c', 'd', 'YELLOW'))
  })
})

describe('zoom and pan', () => {
  it('zoom buttons change the viewBox around the centre and clamp', () => {
    map.zoomIn()
    expect(map.zoom()).toBeCloseTo(1.5)
    expect(box().map(Math.round)).toEqual([380, 302, 240, 196])
    for (let i = 0; i < 20; i++) map.zoomIn()
    expect(map.zoom()).toBe(MAX_ZOOM)
    for (let i = 0; i < 40; i++) map.zoomOut()
    expect(map.zoom()).toBe(MIN_ZOOM)
    expect(box().map(Math.round)).toEqual([-40, -40, 1080, 880]) // MIN_ZOOM is exactly the whole network
  })

  it('fit resets the viewBox', () => {
    map.zoomIn()
    map.fit()
    expect(box().map(Math.round)).toEqual([320, 253, 360, 293])
  })

  it('wheel zooms in around the cursor and keeps that point fixed', () => {
    // 540 px for a 360-unit-wide box: 2/3 unit per px, no horizontal letterbox. Cursor at x = 270 px is svg x = 500.
    svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 270, clientY: 270, bubbles: true, cancelable: true }))
    expect(map.zoom()).toBeCloseTo(1.25)
    const [x, , w] = box()
    expect(x + 270 * (w / 540)).toBeCloseTo(500, 5)
    svg.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 270, clientY: 270, bubbles: true, cancelable: true }))
    expect(map.zoom()).toBeCloseTo(1)
  })

  it('dragging pans by the pixel delta scaled to svg units', () => {
    const ev = (type, x, y, id = 1) => svg.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, ...{ pointerId: id } }))
    const down = new MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true })
    Object.defineProperty(down, 'pointerId', { value: 1 })
    svg.dispatchEvent(down)
    const move = new MouseEvent('pointermove', { clientX: 150, clientY: 120, bubbles: true })
    Object.defineProperty(move, 'pointerId', { value: 1 })
    svg.dispatchEvent(move)
    const [x, y] = box()
    expect(x).toBeCloseTo(320 - 50 * (2 / 3)) // 2/3 svg unit per px
    expect(y).toBeCloseTo(253.33 - 20 * (2 / 3), 1)
    const up = new MouseEvent('pointerup', { bubbles: true })
    Object.defineProperty(up, 'pointerId', { value: 1 })
    svg.dispatchEvent(up)
    void ev
  })

  it('a drag does not count as a station click, a plain click does', () => {
    const g = svg.querySelector('.station[data-id="b"]')
    const pointer = (type, x, y) => {
      const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true })
      Object.defineProperty(e, 'pointerId', { value: 1 })
      g.dispatchEvent(e)
    }
    pointer('pointerdown', 10, 10)
    pointer('pointermove', 30, 10)
    pointer('pointerup', 30, 10)
    g.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onPick).not.toHaveBeenCalled()
    pointer('pointerdown', 10, 10)
    pointer('pointerup', 10, 10)
    g.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onPick).toHaveBeenCalledWith(NETWORK.stations[1], expect.any(MouseEvent)) // the event positions the picker card
  })

  it('BVA: pointer travel up to DRAG_PX is still a click, one more pixel is a drag (trackpad jitter)', () => {
    const g = svg.querySelector('.station[data-id="b"]')
    const pointer = (type, x, y) => {
      const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true })
      Object.defineProperty(e, 'pointerId', { value: 1 })
      g.dispatchEvent(e)
    }
    pointer('pointerdown', 10, 10)
    pointer('pointermove', 10 + DRAG_PX, 10)
    pointer('pointerup', 10 + DRAG_PX, 10)
    g.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onPick).toHaveBeenCalledTimes(1)
    pointer('pointerdown', 10, 10)
    pointer('pointermove', 10 + DRAG_PX + 1, 10)
    pointer('pointerup', 10 + DRAG_PX + 1, 10)
    g.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('does not capture the pointer: with capture the browser retargets the click to the svg and stations never fire', () => {
    svg.setPointerCapture = vi.fn()
    const e = new MouseEvent('pointerdown', { clientX: 1, clientY: 1, bubbles: true })
    Object.defineProperty(e, 'pointerId', { value: 7 })
    svg.dispatchEvent(e)
    expect(svg.setPointerCapture).not.toHaveBeenCalled()
  })

  it('pinch with two pointers zooms', () => {
    const pointer = (type, x, y, id) => {
      const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true })
      Object.defineProperty(e, 'pointerId', { value: id })
      svg.dispatchEvent(e)
    }
    pointer('pointerdown', 200, 270, 1)
    pointer('pointerdown', 300, 270, 2)
    pointer('pointermove', 350, 270, 2) // fingers 100 px apart → 150 px apart
    expect(map.zoom()).toBeCloseTo(1.5)
    pointer('pointerup', 350, 270, 2)
    pointer('pointercancel', 200, 270, 1)
  })
})

describe('tooltip', () => {
  it('shows name, code, lines and interchange status on hover, hides on leave', () => {
    const c = svg.querySelector('.station[data-id="c"]')
    c.dispatchEvent(new MouseEvent('pointerenter', { clientX: 10, clientY: 20 }))
    expect(tooltip.hidden).toBe(false)
    expect(tooltip.innerHTML).toBe('<b>Charlie</b> <small>CHR</small><br>Blue Line, Red Line, Yellow Line<br><i>Interchange</i>')
    expect(tooltip.style.left).toBe('24px')
    c.dispatchEvent(new MouseEvent('pointerleave'))
    expect(tooltip.hidden).toBe(true)
    svg.querySelector('.station[data-id="b"]').dispatchEvent(new MouseEvent('pointerenter', { clientX: 0, clientY: 0 }))
    expect(tooltip.innerHTML).toBe('<b>Bravo</b> <small>BRV</small><br>Red Line')
  })

  it('escapes names in the tooltip', () => {
    svg.querySelector('.station[data-id="d"]').dispatchEvent(new MouseEvent('pointerenter', { clientX: 0, clientY: 0 }))
    expect(tooltip.innerHTML).toContain('Delta &lt;&amp;&gt;')
  })

  it('works without a tooltip element', () => {
    const m = createMap(svg, NETWORK, {})
    expect(() => svg.querySelector('.station').dispatchEvent(new MouseEvent('pointerenter'))).not.toThrow()
    expect(() => svg.querySelector('.station').dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow()
    void m
  })
})
