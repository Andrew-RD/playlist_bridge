const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function normalizeRoomCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

export function isValidRoomCode(value) {
  return ROOM_CODE_PATTERN.test(value)
}

export function isValidParticipantToken(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}
