import { describe, it, expect, vi } from 'vitest'
import { createStore } from '../src/state.js'
import { JOURNEY_0, JOURNEY_1, deferred } from './fixtures.js'
import { ApiError } from '../src/api.js'

const A = { id: 'a', name: 'Alpha' }
const B = { id: 'b', name: 'Bravo' }
const D = { id: 'd', name: 'Delta' }

function setup(fetchRoute = vi.fn(async () => JOURNEY_1)) {
  const store = createStore({ fetchRoute })
  const seen = []
  store.subscribe((s) => seen.push(s.status))
  return { store, seen, fetchRoute }
}

// --- decision table: Find enabled (ER3/ER4; test-plan T-4) ----------------------------------------

describe('blocker / canFind', () => {
  it.each([
    [null, null, 'Pick a source station'],
    [A, null, 'Pick a destination station'],
    [null, B, 'Pick a source station'],
    [A, A, 'Pick two different stations'],
    [A, B, null],
  ])('src=%o dst=%o → %s', (src, dst, blocker) => {
    const { store } = setup()
    store.setSrc(src)
    store.setDst(dst)
    expect(store.blocker()).toBe(blocker)
    expect(store.canFind()).toBe(blocker === null)
  })

  it('is blocked while loading', async () => {
    const d = deferred()
    const { store } = setup(vi.fn(() => d.promise))
    store.setSrc(A)
    store.setDst(B)
    const p = store.find()
    expect(store.blocker()).toBe('Finding route…')
    d.resolve(JOURNEY_1)
    await p
    expect(store.blocker()).toBe(null)
  })
})

// --- state transitions (test-plan T-4 state-transition testing) --------------------------------------

describe('transitions', () => {
  it('idle → loading → ready', async () => {
    const { store, seen, fetchRoute } = setup()
    store.setSrc(A)
    store.setDst(D)
    await store.find()
    expect(seen).toEqual(['idle', 'idle', 'loading', 'ready'])
    expect(store.get().journey).toBe(JOURNEY_1)
    expect(fetchRoute).toHaveBeenCalledWith('a', 'd', expect.any(AbortSignal))
  })

  it('idle → loading → error with the API code', async () => {
    const err = new ApiError({ code: 'no_route', message: 'No route between Alpha and Hotel' })
    const { store } = setup(vi.fn(async () => { throw err }))
    store.setSrc(A)
    store.setDst({ id: 'h', name: 'Hotel' })
    await store.find()
    expect(store.get().status).toBe('error')
    expect(store.get().error).toEqual({ code: 'no_route', message: 'No route between Alpha and Hotel', suggestion: undefined })
  })

  it('a thrown non-ApiError becomes a network error', async () => {
    const { store } = setup(vi.fn(async () => { throw new TypeError('boom') }))
    store.setSrc(A)
    store.setDst(B)
    await store.find()
    expect(store.get().error.code).toBe('network')
  })

  it('same_station from the server still lands in the error state', async () => {
    // the UI blocks this before it reaches the server; the store must still cope if it ever gets through
    const { store } = setup(vi.fn(async () => { throw new ApiError({ code: 'same_station', message: 'same' }) }))
    store.setSrc(A)
    store.setDst({ ...A, name: 'Alpha (copy)', id: 'a2' })
    await store.find()
    expect(store.get().status).toBe('error')
  })

  it('find() while blocked is a no-op', async () => {
    const { store, fetchRoute } = setup()
    await store.find()
    expect(fetchRoute).not.toHaveBeenCalled()
    expect(store.get().status).toBe('idle')
  })

  it('changing an endpoint clears the journey immediately', async () => {
    const { store } = setup()
    store.setSrc(A)
    store.setDst(D)
    await store.find()
    store.setDst(B)
    expect(store.get()).toMatchObject({ status: 'idle', journey: null, error: null, dst: B })
  })

  it('reset clears everything', async () => {
    const { store } = setup()
    store.setSrc(A)
    store.setDst(D)
    await store.find()
    store.reset()
    expect(store.get()).toMatchObject({ src: null, dst: null, journey: null, status: 'idle', error: null })
  })

  it('swap exchanges endpoints and drops the journey', async () => {
    const { store } = setup()
    store.setSrc(A)
    store.setDst(D)
    await store.find()
    store.swap()
    expect(store.get()).toMatchObject({ src: D, dst: A, journey: null, status: 'idle' })
  })

  it('unsubscribe stops notifications', () => {
    const store = createStore({})
    const l = vi.fn()
    store.subscribe(l)()
    store.setSrc(A)
    expect(l).not.toHaveBeenCalled()
  })
})

// --- races (ER7; test-plan T-8) ------------------------------------------------------------------------

describe('stale responses', () => {
  it('two finds resolving out of order show only the latest', async () => {
    const first = deferred()
    const second = deferred()
    const fetchRoute = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { store } = setup(fetchRoute)
    store.setSrc(A)
    store.setDst(B)
    const p1 = store.find()
    store.setDst(D) // user changes their mind while the first request is in flight
    const p2 = store.find()
    second.resolve(JOURNEY_1)
    await p2
    expect(store.get()).toMatchObject({ status: 'ready', journey: JOURNEY_1 })
    first.resolve(JOURNEY_0) // the old answer arrives late
    await p1
    expect(store.get().journey).toBe(JOURNEY_1)
    expect(fetchRoute.mock.calls[0][2].aborted).toBe(true) // and the first request was cancelled
  })

  it('a late error for an old request is ignored too', async () => {
    const first = deferred()
    const fetchRoute = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(JOURNEY_1)
    const { store } = setup(fetchRoute)
    store.setSrc(A)
    store.setDst(B)
    const p1 = store.find()
    store.setDst(D)
    await store.find()
    first.reject(new ApiError({ code: 'no_route', message: 'late' }))
    await p1
    expect(store.get().status).toBe('ready')
  })

  it('reset during loading drops the result when it arrives', async () => {
    const d = deferred()
    const { store } = setup(vi.fn(() => d.promise))
    store.setSrc(A)
    store.setDst(B)
    const p = store.find()
    store.reset()
    d.resolve(JOURNEY_0)
    await p
    expect(store.get()).toMatchObject({ status: 'idle', journey: null, src: null })
  })

  it('double-clicking Find sends one request', async () => {
    const d = deferred()
    const fetchRoute = vi.fn(() => d.promise)
    const { store } = setup(fetchRoute)
    store.setSrc(A)
    store.setDst(B)
    const p = store.find()
    store.find()
    expect(fetchRoute).toHaveBeenCalledTimes(1)
    d.resolve(JOURNEY_0)
    await p
  })
})
