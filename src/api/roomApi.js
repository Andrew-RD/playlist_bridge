const FUNCTION_ROOT = '/.netlify/functions'

export class RoomApiError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'RoomApiError'
    this.code = code
    this.status = status
  }
}

async function post(endpoint, body, options = {}) {
  let response

  try {
    response = await fetch(`${FUNCTION_ROOT}/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error

    throw new RoomApiError(
      'network_error',
      'Couldn’t reach the room service. Check your connection and try again.',
      0,
    )
  }

  let payload

  try {
    payload = await response.json()
  } catch {
    throw new RoomApiError(
      'invalid_response',
      'The room service returned an unexpected response. Please try again.',
      response.status,
    )
  }

  if (!response.ok) {
    throw new RoomApiError(
      payload?.error?.code ?? 'request_failed',
      payload?.error?.message ?? 'The room request failed. Please try again.',
      response.status,
    )
  }

  return payload
}

export function normalizeRoomCode(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

export function createRoom(options) {
  return post('create-room', {}, options)
}

export function joinRoom(code, participantToken, options) {
  return post('join-room', { code, participantToken }, options)
}

export function getRoom(code, participantToken, options) {
  return post('get-room', { code, participantToken }, options)
}

export function leaveRoom(code, participantToken, options) {
  return post('leave-room', { code, participantToken }, options)
}

export function heartbeatRoom(code, participantToken, options) {
  return post('heartbeat', { code, participantToken }, options)
}
