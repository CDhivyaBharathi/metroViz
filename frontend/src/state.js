// Single UI store (PLAN.md C6 state.js): one state object, a listener set, a handful of actions. No framework.
// ER3/ER4: find() refuses unless both stations are set and differ (see blocker()).
// ER7: every find() gets a request id; a response that arrives for an older id is dropped, so out-of-order
// replies and replies after reset() can never overwrite the current view. The AbortController only saves bandwidth.

export function createStore(api) {
  let state = { src: null, dst: null, journey: null, status: 'idle', error: null, reqId: 0 }
  const listeners = new Set()
  let controller = null

  function set(patch) {
    state = { ...state, ...patch }
    listeners.forEach((l) => l(state))
  }

  function cancel() {
    controller?.abort()
    controller = null
  }

  function pick(field, station) {
    cancel()
    set({ [field]: station, journey: null, status: 'idle', error: null }) // a changed endpoint invalidates the route
  }

  function blocker() {
    if (state.status === 'loading') return 'Finding route…'
    if (!state.src) return 'Pick a source station'
    if (!state.dst) return 'Pick a destination station'
    if (state.src.id === state.dst.id) return 'Pick two different stations'
    return null
  }

  async function find() {
    if (blocker()) return
    cancel()
    controller = new AbortController()
    const id = state.reqId + 1
    set({ status: 'loading', journey: null, error: null, reqId: id })
    try {
      const journey = await api.fetchRoute(state.src.id, state.dst.id, controller.signal)
      if (state.reqId === id && state.status === 'loading') set({ status: 'ready', journey })
    } catch (e) {
      if (state.reqId === id && state.status === 'loading') {
        set({ status: 'error', error: { code: e.code ?? 'network', message: e.message, suggestion: e.suggestion } })
      }
    }
  }

  return {
    get: () => state,
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    blocker,
    canFind: () => blocker() === null,
    setSrc: (s) => pick('src', s),
    setDst: (s) => pick('dst', s),
    swap() {
      cancel()
      set({ src: state.dst, dst: state.src, journey: null, status: 'idle', error: null })
    },
    find,
    reset() {
      cancel()
      set({ src: null, dst: null, journey: null, status: 'idle', error: null })
    },
  }
}
