// Station combobox (PLAN.md C6 search.js): debounced /api/search, ↑ ↓ Enter Esc, did-you-mean (ER2), clear button.
// `search(q)` is injected so tests can fake the API; `onSelect(station|null)` reports the pick.
// An empty box lists every station A→Z (`stations`, from /api/network) so the user can browse as well as type.

export const DEBOUNCE_MS = 150

export function createCombobox({ input, list, clearButton, search, onSelect, stations = [] }) {
  const all = [...stations].sort((a, b) => a.name.localeCompare(b.name))
  let timer = null
  let reqId = 0 // ER7 for suggestions: a slow reply for an older keystroke is dropped
  let results = []
  let suggestion = null
  let active = -1
  let noMatch = false // true only right after a query that found nothing

  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  list.setAttribute('role', 'listbox')

  function render() {
    const items = results.map(
      (s, i) =>
        `<li role="option" data-index="${i}" aria-selected="${i === active}" class="${i === active ? 'active' : ''}">` +
        `<span>${escape(s.name)}</span><small>${escape(s.code)} · ${s.lines.map(escape).join(', ')}</small></li>`,
    )
    if (!results.length && suggestion) {
      items.push(`<li class="no-match">No match. Did you mean <button type="button" data-suggest>${escape(suggestion.name)}</button>?</li>`)
    } else if (!results.length && noMatch) {
      items.push('<li class="no-match">No match</li>')
    }
    list.innerHTML = items.join('')
    list.hidden = items.length === 0
    input.setAttribute('aria-expanded', String(!list.hidden))
  }

  function close() {
    results = []
    suggestion = null
    active = -1
    noMatch = false
    render()
  }

  function showAll() {
    close()
    results = all
    render()
  }

  async function query() {
    const q = input.value.trim()
    if (!q) return showAll()
    const id = ++reqId
    let body
    try {
      body = await search(q)
    } catch {
      if (id === reqId) close() // a failed suggestion request is not worth an error; the Find button still works
      return
    }
    if (id !== reqId) return
    results = body.results
    suggestion = body.suggestion ?? null
    noMatch = !results.length
    active = results.length ? 0 : -1
    render()
  }

  function choose(station) {
    input.value = station.name
    close()
    onSelect(station)
  }

  input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(query, DEBOUNCE_MS)
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && results.length) {
      active = (active + 1) % results.length
      render()
    } else if (e.key === 'ArrowUp' && results.length) {
      active = (active <= 0 ? results.length : active) - 1
      render()
    } else if (e.key === 'Enter') {
      e.preventDefault() // never submit the form from inside the combobox
      if (active >= 0) choose(results[active])
      else if (suggestion) choose(suggestion)
    } else if (e.key === 'Escape') {
      close()
    } else {
      return
    }
  })
  input.addEventListener('blur', () => (list.hidden = true))
  input.addEventListener('focus', () => (input.value.trim() ? results.length && render() : showAll()))
  input.addEventListener('click', () => list.hidden && !input.value.trim() && showAll())
  list.addEventListener('pointerdown', (e) => e.preventDefault()) // keep focus on the input while clicking an item
  list.addEventListener('click', (e) => {
    if (e.target.closest('[data-suggest]')) return choose(suggestion)
    const li = e.target.closest('[data-index]')
    if (li) choose(results[+li.dataset.index])
  })
  clearButton.addEventListener('click', () => {
    input.value = ''
    close()
    onSelect(null)
    input.focus()
  })

  return {
    setValue(station) {
      input.value = station ? station.name : ''
      close()
    },
    query,
  }
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
