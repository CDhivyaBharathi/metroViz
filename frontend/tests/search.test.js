import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createCombobox, DEBOUNCE_MS } from '../src/search.js'

const ALPHA = { id: 'a', name: 'Alpha', code: 'ALP', lines: ['RED', 'YELLOW'] }
const ALPINE = { id: 'al', name: 'Alpine <x>', code: 'ALN', lines: ['RED'] }

let input, list, clear, search, onSelect, box

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = '<input id="src"><button id="clear"></button><ul id="list" hidden></ul>'
  input = document.querySelector('input')
  list = document.querySelector('ul')
  clear = document.querySelector('button')
  search = vi.fn(async () => ({ results: [ALPHA, ALPINE] }))
  onSelect = vi.fn()
  box = createCombobox({ input, list, clearButton: clear, search, onSelect })
})
afterEach(() => vi.useRealTimers())

const type = (text) => {
  input.value = text
  input.dispatchEvent(new Event('input'))
}
const key = (k) => input.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true }))
const settle = () => vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

describe('querying', () => {
  it('debounces rapid typing into one request', async () => {
    type('a')
    type('al')
    type('alp')
    expect(search).not.toHaveBeenCalled()
    await settle()
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('alp')
    expect(list.hidden).toBe(false)
    expect(list.querySelectorAll('[role=option]')).toHaveLength(2)
    expect(list.textContent).toContain('Alpine <x>')
    expect(list.innerHTML).not.toContain('<x>')
    expect(input.getAttribute('aria-expanded')).toBe('true')
  })

  it.each(['', '   '])('empty or whitespace query (%j) sends nothing', async (q) => {
    type(q)
    await settle()
    expect(search).not.toHaveBeenCalled()
    expect(list.hidden).toBe(true)
  })

  it('drops a slow reply for an older keystroke', async () => {
    let slow
    search.mockImplementationOnce(() => new Promise((r) => (slow = r))).mockImplementationOnce(async () => ({ results: [ALPINE] }))
    type('a')
    await settle()
    type('alpi')
    await settle()
    slow({ results: [ALPHA] }) // the first reply arrives last
    await vi.advanceTimersByTimeAsync(0)
    expect(list.querySelectorAll('[role=option]')).toHaveLength(1)
    expect(list.textContent).toContain('Alpine')
  })

  it('shows the did-you-mean suggestion and selects it on click or Enter', async () => {
    search.mockResolvedValue({ results: [], suggestion: { id: 'a', name: 'Alpha' } })
    type('Alpah')
    await settle()
    expect(list.textContent).toContain('No match. Did you mean Alpha?')
    list.querySelector('[data-suggest]').click()
    expect(onSelect).toHaveBeenCalledWith({ id: 'a', name: 'Alpha' })
    expect(input.value).toBe('Alpha')
    type('Alpah')
    await settle()
    key('Enter')
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('shows a plain "No match" when there is no suggestion', async () => {
    search.mockResolvedValue({ results: [] })
    type('qzx')
    await settle()
    expect(list.textContent).toBe('No match')
  })

  it('a failed request shows nothing and does not throw', async () => {
    search.mockRejectedValue(new Error('down'))
    type('alp')
    await settle()
    expect(list.hidden).toBe(true)
  })
})

describe('browsing every station (empty box)', () => {
  const ZULU = { id: 'z', name: 'Zulu', code: 'ZLU', lines: ['GREEN'] }
  beforeEach(() => {
    document.body.innerHTML = '<input id="src"><button id="clear"></button><ul id="list" hidden></ul>' // fresh DOM: one combobox per input
    input = document.querySelector('input')
    list = document.querySelector('ul')
    clear = document.querySelector('button')
    box = createCombobox({ input, list, clearButton: clear, search, onSelect, stations: [ZULU, ALPINE, ALPHA] })
  })

  it('focus or click on an empty box lists all stations A→Z without a request', () => {
    input.dispatchEvent(new Event('focus'))
    expect(search).not.toHaveBeenCalled()
    expect([...list.querySelectorAll('[role=option] span')].map((n) => n.textContent)).toEqual(['Alpha', 'Alpine <x>', 'Zulu'])
    expect(list.querySelector('.active')).toBeNull() // nothing preselected: Enter must not pick a station blindly
    key('Enter')
    expect(onSelect).not.toHaveBeenCalled()
    input.dispatchEvent(new Event('blur'))
    expect(list.hidden).toBe(true)
    input.click()
    expect(list.hidden).toBe(false)
  })

  it('↑ from nothing goes to the last item, ↓ to the first; clicking picks', () => {
    input.dispatchEvent(new Event('focus'))
    key('ArrowUp')
    expect(list.querySelector('.active').textContent).toContain('Zulu')
    key('ArrowDown')
    expect(list.querySelector('.active').textContent).toContain('Alpha')
    list.querySelectorAll('[role=option]')[2].click()
    expect(onSelect).toHaveBeenCalledWith(ZULU)
    expect(input.value).toBe('Zulu')
  })

  it('deleting the text returns to the full list; a filled box on focus keeps its matches', async () => {
    type('al')
    await settle()
    expect(list.querySelectorAll('[role=option]')).toHaveLength(2)
    type('')
    await settle()
    expect(search).toHaveBeenCalledTimes(1)
    expect(list.querySelectorAll('[role=option]')).toHaveLength(3)
    type('al')
    await settle()
    input.dispatchEvent(new Event('focus'))
    expect(list.querySelectorAll('[role=option]')).toHaveLength(2)
  })
})

describe('keyboard', () => {
  it('↓ ↑ move the active item with wrap-around and Enter selects it', async () => {
    type('al')
    await settle()
    expect(list.querySelector('.active').textContent).toContain('Alpha')
    key('ArrowDown')
    expect(list.querySelector('.active').textContent).toContain('Alpine')
    key('ArrowDown')
    expect(list.querySelector('.active').textContent).toContain('Alpha')
    key('ArrowUp')
    expect(list.querySelector('.active').textContent).toContain('Alpine')
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    input.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(true)
    expect(onSelect).toHaveBeenCalledWith(ALPINE)
    expect(input.value).toBe('Alpine <x>')
    expect(list.hidden).toBe(true)
  })

  it('Escape closes the list without selecting', async () => {
    type('al')
    await settle()
    key('Escape')
    expect(list.hidden).toBe(true)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('Enter with nothing to pick does nothing but still blocks the form', () => {
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    input.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(true)
    expect(onSelect).not.toHaveBeenCalled()
    key('ArrowDown') // no results: ignored
    key('x') // ordinary key: ignored
  })
})

describe('mouse, clear, blur', () => {
  it('clicking an option selects it', async () => {
    type('al')
    await settle()
    list.querySelectorAll('[role=option]')[1].querySelector('small').click()
    expect(onSelect).toHaveBeenCalledWith(ALPINE)
  })

  it('clicking the list background does nothing', async () => {
    type('al')
    await settle()
    list.click()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('pointerdown on the list is prevented so the input keeps focus', async () => {
    const e = new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
    list.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })

  it('clear empties the field, reports null and refocuses', async () => {
    type('al')
    await settle()
    clear.click()
    expect(input.value).toBe('')
    expect(onSelect).toHaveBeenCalledWith(null)
    expect(list.hidden).toBe(true)
    expect(document.activeElement).toBe(input)
  })

  it('blur hides the list, focus shows it again if there are results', async () => {
    type('al')
    await settle()
    input.dispatchEvent(new Event('blur'))
    expect(list.hidden).toBe(true)
    input.dispatchEvent(new Event('focus'))
    expect(list.hidden).toBe(false)
  })

  it('setValue fills or empties the input from outside (map pick, reset)', () => {
    box.setValue(ALPHA)
    expect(input.value).toBe('Alpha')
    box.setValue(null)
    expect(input.value).toBe('')
  })
})
