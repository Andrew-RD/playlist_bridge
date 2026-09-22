const STORAGE_KEY = 'playlist-bridge:rooms'
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

function readRooms() {
  try {
    const rooms = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return rooms && typeof rooms === 'object' ? rooms : {}
  } catch {
    return {}
  }
}

function writeRooms(rooms) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms))
}

export function normalizeRoomCode(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)
}

function generateCode() {
  let code = ''
  const randomValues = new Uint32Array(CODE_LENGTH)
  crypto.getRandomValues(randomValues)

  for (const value of randomValues) {
    code += CODE_ALPHABET[value % CODE_ALPHABET.length]
  }

  return code
}

export function createRoom() {
  const rooms = readRooms()
  let code = generateCode()

  while (rooms[code]) {
    code = generateCode()
  }

  const room = {
    code,
    createdAt: new Date().toISOString(),
    participantsCount: 1,
    maxParticipants: 2,
  }

  rooms[code] = room
  writeRooms(rooms)
  return room
}

export function getRoom(value) {
  const code = normalizeRoomCode(value)
  return readRooms()[code] ?? null
}

export function joinRoom(value) {
  const code = normalizeRoomCode(value)
  const rooms = readRooms()
  const room = rooms[code]

  if (!room) {
    return { ok: false, reason: 'not-found' }
  }

  if (room.participantsCount >= room.maxParticipants) {
    return { ok: false, reason: 'full' }
  }

  const updatedRoom = {
    ...room,
    participantsCount: room.participantsCount + 1,
  }

  rooms[code] = updatedRoom
  writeRooms(rooms)
  return { ok: true, room: updatedRoom }
}

export function leaveRoom(value) {
  const code = normalizeRoomCode(value)
  const rooms = readRooms()
  const room = rooms[code]

  if (!room) {
    return { ok: false, reason: 'not-found' }
  }

  const participantsCount = Math.max(0, Number(room.participantsCount) || 0)

  if (participantsCount <= 1) {
    delete rooms[code]
    writeRooms(rooms)
    return { ok: true, removed: true, room: null }
  }

  const updatedRoom = {
    ...room,
    participantsCount: Math.max(0, participantsCount - 1),
  }

  rooms[code] = updatedRoom
  writeRooms(rooms)
  return { ok: true, removed: false, room: updatedRoom }
}
