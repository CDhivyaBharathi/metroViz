import { describe, it, expect } from 'vitest'
import { renderJourney, renderError, renderHint, renderLoading, renderPicker, esc, MESSAGES } from '../src/panel.js'
import { NET, JOURNEY_0, JOURNEY_1, JOURNEY_2 } from './fixtures.js'

const text = (html) => {
  const d = document.createElement('div')
  d.innerHTML = html.replace(/>/g, '> ') // keep a space between elements
  return d.textContent.replace(/\s+/g, ' ').trim()
}

describe('renderJourney', () => {
  it('golden: one-interchange journey', () => {
    expect(renderJourney(JOURNEY_1, NET)).toBe(
      '<div class="summary"><div class="ends">Alpha → Delta &lt;&amp;&gt;</div>' +
        '<div class="stats"><span>≈ 5 min</span><span>3 stops</span><span>1 interchange</span></div>' +
        '<div class="chips"><span class="chip" style="--c:#FFDF00">Yellow Line</span><span class="chip" style="--c:#FF4040">Red Line</span></div></div>' +
        '<ol class="steps">' +
        '<li>Board the <b>Yellow Line</b> at <b>Alpha</b></li>' +
        '<li>Ride 2 stops to <b>Charlie</b> <small>(≈ 3 min)</small></li>' +
        '<li class="change">Change at <b>Charlie</b> to the <b>Red Line</b></li>' +
        '<li>Ride 1 stop to <b>Delta &lt;&amp;&gt;</b> <small>(≈ 2 min)</small></li>' +
        '<li>Get down at <b>Delta &lt;&amp;&gt;</b></li>' +
        '</ol>',
    )
  })

  it('zero interchanges: no change step, plural/singular right', () => {
    const t = text(renderJourney(JOURNEY_0, NET))
    expect(t).toContain('≈ 4 min 2 stops 0 interchanges')
    expect(t).not.toContain('Change at')
    expect(t).toContain('Board the Red Line at Bravo Ride 2 stops to Delta <&> (≈ 4 min) Get down at Delta <&>')
  })

  it('two interchanges: two change steps in order, chips for all three lines', () => {
    const html = renderJourney(JOURNEY_2, NET)
    expect(html.match(/class="change"/g)).toHaveLength(2)
    expect(text(html)).toContain('Change at Charlie to the Yellow Line')
    expect(text(html)).toContain('Change at Alpha to the Red Line')
    expect(text(html)).toContain('2 interchanges')
    expect(html.match(/class="chip"/g)).toHaveLength(3)
  })

  it('shows exits only when the destination has them', () => {
    const toC = { ...JOURNEY_0, destination: { id: 'c', name: 'Charlie' } }
    expect(renderJourney(toC, NET)).toContain('<details class="exits"><summary>Exits at Charlie</summary><ul><li><b>Gate No. 1</b> Market</li>')
    expect(renderJourney(JOURNEY_0, NET)).not.toContain('exits')
  })

  it('falls back to the line id when the line is unknown', () => {
    expect(renderJourney(JOURNEY_0, { lines: {}, stations: {} })).toContain('>RED</span>')
  })

  it('escapes station names (no HTML injection)', () => {
    const html = renderJourney(JOURNEY_1, NET)
    expect(html).not.toContain('<&>')
    expect(html).toContain('Delta &lt;&amp;&gt;')
  })
})

describe('renderPicker', () => {
  it('names the station and marks the slot it went into; the other button is plain', () => {
    const html = renderPicker({ name: 'Delta <&>', code: 'DLT' }, 'dst')
    expect(html).toContain('<b>Delta &lt;&amp;&gt;</b> <small>DLT</small>')
    expect(html).toContain('<button type="button" data-set="src" class="">From here</button>')
    expect(html).toContain('<button type="button" data-set="dst" class="active">To here ✓</button>')
    expect(renderPicker({ name: 'A', code: 'A' }, 'src')).toContain('data-set="src" class="active">From here ✓')
  })
})

describe('renderError / renderHint / renderLoading', () => {
  it.each(Object.keys(MESSAGES))('has wording for %s', (code) => {
    expect(text(renderError({ code, message: 'server text' }))).toBe(MESSAGES[code])
  })

  it('uses the server message for no_route (ER5 wording)', () => {
    expect(text(renderError({ code: 'no_route', message: 'No route between Alpha and Hotel' }))).toBe('No route between Alpha and Hotel')
  })

  it('appends the suggestion when present (ER2)', () => {
    const html = renderError({ code: 'unknown_station', message: 'x', suggestion: { id: 'a', name: 'A<b>' } })
    expect(html).toContain('Did you mean <b>A&lt;b&gt;</b>?')
    expect(html).toContain('role="alert"')
  })

  it('unknown codes get a generic message', () => {
    expect(text(renderError({ code: 'internal', message: 'secret' }))).toBe('Something went wrong. Please try again.')
  })

  it('hint shows the blocker or the default prompt', () => {
    expect(renderHint('Pick a source station')).toBe('<p class="hint">Pick a source station</p>')
    expect(renderHint(null)).toBe('<p class="hint">Press Find route.</p>')
    expect(renderLoading()).toContain('aria-busy="true"')
  })

  it('esc covers the five HTML metacharacters', () => {
    expect(esc(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  })
})
