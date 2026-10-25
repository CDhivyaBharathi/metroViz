// Fetch wrappers over the backend contract (PLAN.md §API contract).
// Any failure becomes an ApiError {code, message, suggestion?} that the panel knows how to word.

export class ApiError extends Error {
  constructor({ code, message, suggestion }) {
    super(message)
    this.code = code
    this.suggestion = suggestion
  }
}

async function get(url, signal) {
  let res
  try {
    res = await fetch(url, { signal })
  } catch (e) {
    if (e.name === 'AbortError') throw e // the caller cancelled on purpose; never shown as an error
    throw new ApiError({ code: 'network', message: "Couldn't reach the server. Is the backend running?" })
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(body.error ?? { code: `http_${res.status}`, message: `Server error (${res.status})` })
  return body
}

export const fetchNetwork = (signal) => get('/api/network', signal)
export const searchStations = (q, signal) => get(`/api/search?q=${encodeURIComponent(q)}`, signal)
export const fetchRoute = (src, dst, signal) =>
  get(`/api/route?src=${encodeURIComponent(src)}&dst=${encodeURIComponent(dst)}`, signal)
