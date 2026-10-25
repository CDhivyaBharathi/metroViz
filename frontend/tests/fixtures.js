// The backend's mini.json as /api/network and /api/route would return it (x/y are hand-placed, not projected).
export const NETWORK = {
  lines: [
    { id: 'RED', name: 'Red Line', color: '#FF4040' },
    { id: 'BLUE', name: 'Blue Line', color: '#4169E1' },
    { id: 'YELLOW', name: 'Yellow Line', color: '#FFDF00' },
    { id: 'GREEN', name: 'Green Line', color: '#008000' },
  ],
  stations: [
    { id: 'a', name: 'Alpha', code: 'ALP', lines: ['RED', 'YELLOW'], is_interchange: true, x: 0, y: 500 },
    { id: 'b', name: 'Bravo', code: 'BRV', lines: ['RED'], is_interchange: false, x: 200, y: 500 },
    { id: 'c', name: 'Charlie', code: 'CHR', lines: ['BLUE', 'RED', 'YELLOW'], is_interchange: true, x: 400, y: 500,
      exits: [{ gate: 'Gate No. 1', location: 'Market' }, { gate: 'Gate No. 2', location: 'Bus stand' }] },
    { id: 'd', name: 'Delta <&>', code: 'DLT', lines: ['RED'], is_interchange: false, x: 600, y: 500 },
    { id: 'e', name: 'Echo', code: 'ECH', lines: ['BLUE'], is_interchange: false, x: 400, y: 200 },
    { id: 'f', name: 'Foxtrot', code: 'FXT', lines: ['BLUE'], is_interchange: false, x: 400, y: 800 },
    { id: 'g', name: 'Golf', code: 'GLF', lines: ['YELLOW'], is_interchange: false, x: 200, y: 400 },
    { id: 'h', name: 'Hotel', code: 'HTL', lines: ['GREEN'], is_interchange: false, x: 900, y: 100 },
    { id: 'i', name: 'India', code: 'IND', lines: ['GREEN'], is_interchange: false, x: 1000, y: 100 },
  ],
  edges: [
    { a: 'a', b: 'b', line: 'RED', minutes: 2 },
    { a: 'b', b: 'c', line: 'RED', minutes: 2 },
    { a: 'c', b: 'd', line: 'RED', minutes: 2 },
    { a: 'e', b: 'c', line: 'BLUE', minutes: 3 },
    { a: 'c', b: 'f', line: 'BLUE', minutes: 3 },
    { a: 'a', b: 'g', line: 'YELLOW', minutes: 1 },
    { a: 'g', b: 'c', line: 'YELLOW', minutes: 1.5 },
    { a: 'h', b: 'i', line: 'GREEN', minutes: 2 },
    { a: 'c', b: 'd', line: 'YELLOW', minutes: 2 }, // shared track with RED c–d, as in the real Anand Vihar–Karkarduma
  ],
}

export const NET = {
  lines: Object.fromEntries(NETWORK.lines.map((l) => [l.id, l])),
  stations: Object.fromEntries(NETWORK.stations.map((s) => [s.id, s])),
}

const ref = (id) => ({ id, name: NET.stations[id].name })

export const JOURNEY_0 = { // b → d, one leg
  source: ref('b'), destination: ref('d'), total_minutes: 4, interchanges: 0, lines: ['RED'], station_ids: ['b', 'c', 'd'],
  legs: [{ line: 'RED', from: ref('b'), to: ref('d'), stops: 2, minutes: 4, station_ids: ['b', 'c', 'd'] }],
}

export const JOURNEY_1 = { // a → d via Golf, change at Charlie
  source: ref('a'), destination: ref('d'), total_minutes: 4.5, interchanges: 1, lines: ['YELLOW', 'RED'], station_ids: ['a', 'g', 'c', 'd'],
  legs: [
    { line: 'YELLOW', from: ref('a'), to: ref('c'), stops: 2, minutes: 2.5, station_ids: ['a', 'g', 'c'] },
    { line: 'RED', from: ref('c'), to: ref('d'), stops: 1, minutes: 2, station_ids: ['c', 'd'] },
  ],
}

export const JOURNEY_2 = { // e → g: BLUE, change at Charlie to YELLOW … pretend a third leg to exercise 2 changes
  source: ref('e'), destination: ref('b'), total_minutes: 7.5, interchanges: 2, lines: ['BLUE', 'YELLOW', 'RED'], station_ids: ['e', 'c', 'g', 'a', 'b'],
  legs: [
    { line: 'BLUE', from: ref('e'), to: ref('c'), stops: 1, minutes: 3, station_ids: ['e', 'c'] },
    { line: 'YELLOW', from: ref('c'), to: ref('a'), stops: 2, minutes: 2.5, station_ids: ['c', 'g', 'a'] },
    { line: 'RED', from: ref('a'), to: ref('b'), stops: 1, minutes: 2, station_ids: ['a', 'b'] },
  ],
}

export const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
export const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
