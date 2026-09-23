const SESSION_STORAGE_KEY = 'playlist-bridge:participant-sessions'
const LEGACY_ROOMS_KEY = 'playlist-bridge:rooms'

function readSessions() {
  try {
    const sessions = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? '{}')
    return sessions && typeof sessions === 'object' ? sessions : {}
  } catch {
    return {}
  }
}

function writeSessions(sessions) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions))
}

export function getParticipantToken(code) {
  const token = readSessions()[code]
  return typeof token === 'string' ? token : null
}

export function saveParticipantToken(code, token) {
  const sessions = readSessions()
  sessions[code] = token
  writeSessions(sessions)
}

export function removeParticipantToken(code) {
  const sessions = readSessions()
  delete sessions[code]
  writeSessions(sessions)
}

export function removeLegacyRoomData() {
  try {
    localStorage.removeItem(LEGACY_ROOMS_KEY)
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}
