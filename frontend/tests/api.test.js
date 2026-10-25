import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchNetwork, fetchRoute, searchStations, ApiError } from '../src/api.js'
import { jsonResponse } from './fixtures.js'

afterEach(() => vi.unstubAllGlobals())

describe('api.js', () => {
  it('returns the JSON body on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ lines: [] })))
    expect(await fetchNetwork()).toEqual({ lines: [] })
    expect(fetch).toHaveBeenCalledWith('/api/network', { signal: undefined })
  })

  it('encodes query parameters', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [] })))
    await searchStations('Dr. & Co')
    await fetchRoute('a b', 'c&d')
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['/api/search?q=Dr.%20%26%20Co', '/api/route?src=a%20b&dst=c%26d'])
  })

  it('turns a contract error body into an ApiError with code and suggestion', async () => {
    const error = { code: 'unknown_station', message: "Unknown station 'x'", suggestion: { id: 'a', name: 'Alpha' } }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error }, 404)))
    const e = await fetchRoute('x', 'a').catch((e) => e)
    expect(e).toBeInstanceOf(ApiError)
    expect([e.code, e.message, e.suggestion]).toEqual(['unknown_station', "Unknown station 'x'", { id: 'a', name: 'Alpha' }])
  })

  it('handles a non-JSON error response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError() } })))
    const e = await fetchNetwork().catch((e) => e)
    expect(e.code).toBe('http_502')
  })

  it('maps a network failure to a friendly message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const e = await fetchNetwork().catch((e) => e)
    expect(e.code).toBe('network')
    expect(e.message).toMatch(/reach the server/)
  })

  it('lets an abort through untouched so callers can ignore it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_, { signal }) => { throw Object.assign(new Error('aborted'), { name: 'AbortError', signal }) }))
    const c = new AbortController()
    const e = await fetchRoute('a', 'b', c.signal).catch((e) => e)
    expect(e.name).toBe('AbortError')
    expect(e).not.toBeInstanceOf(ApiError)
  })
})
