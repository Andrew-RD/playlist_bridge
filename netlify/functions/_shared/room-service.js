import { randomBytes, randomUUID } from 'node:crypto'
import { RequestError, roomFromRpc } from './http.js'
import { getPlatformRoomState } from './platform-service.js'
import { firstRpcRow, getSupabase } from './supabase.js'
import { getSpotifyRoomState } from './spotify-service.js'
import { isValidParticipantToken, isValidRoomCode, normalizeRoomCode } from './validation.js'

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ROOM_CODE_LENGTH = 6
const MAX_CREATE_ATTEMPTS = 8

function createRoomCode() {
  const bytes = randomBytes(ROOM_CODE_LENGTH)
  let code = ''

  for (const byte of bytes) {
    code += ROOM_CODE_ALPHABET[byte & 31]
  }

  return code
}

function validateCode(value) {
  const code = normalizeRoomCode(value)

  if (!isValidRoomCode(code)) {
    throw new RequestError('invalid_room_code', 'Enter a valid 6-character room code.')
  }

  return code
}

function validateToken(value, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) {
    return null
  }

  if (!isValidParticipantToken(value)) {
    throw new RequestError('invalid_participant_token', 'The participant token is invalid.')
  }

  return value
}

async function callRoomRpc(name, params) {
  const { data, error } = await getSupabase().rpc(name, params)

  if (error) throw error

  const row = firstRpcRow(data)

  if (!row) {
    throw new Error(`Room RPC ${name} returned no data`)
  }

  return row
}

async function enrichRoom(room, code, participantToken) {
  const [platform, spotify] = await Promise.all([
    getPlatformRoomState(code, participantToken),
    getSpotifyRoomState(code, participantToken),
  ])

  return {
    ...room,
    currentParticipant: platform.currentParticipant,
    partner: platform.partner,
    rolesAssigned: platform.rolesAssigned,
    spotify,
    apple: platform.apple,
  }
}

export async function createRoom() {
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const code = createRoomCode()
    const participantToken = randomUUID()
    const { data, error } = await getSupabase().rpc('create_playlist_room', {
      p_code: code,
      p_participant_token: participantToken,
    })

    if (error?.code === '23505') continue
    if (error) throw error

    const row = firstRpcRow(data)

    if (!row) throw new Error('Create room RPC returned no data')

    return { room: roomFromRpc(row), participantToken }
  }

  throw new Error('Could not allocate a unique room code')
}

export async function joinRoom(codeValue, tokenValue) {
  const code = validateCode(codeValue)
  const participantToken = validateToken(tokenValue, { optional: true }) ?? randomUUID()
  const row = await callRoomRpc('join_playlist_room', {
    p_code: code,
    p_participant_token: participantToken,
  })

  if (row.result_status === 'not_found') {
    throw new RequestError('room_not_found', 'We couldn’t find that room.', 404)
  }

  if (row.result_status === 'full') {
    throw new RequestError('room_full', 'That room is already full.', 409)
  }

  if (row.result_status === 'token_conflict') {
    throw new RequestError('participant_conflict', 'This participant token is already in use.', 409)
  }

  return { room: roomFromRpc(row), participantToken }
}

export async function getRoom(codeValue, tokenValue) {
  const code = validateCode(codeValue)
  const participantToken = validateToken(tokenValue)
  const row = await callRoomRpc('get_playlist_room', {
    p_code: code,
    p_participant_token: participantToken,
  })

  if (row.result_status === 'not_found') {
    throw new RequestError('room_not_found', 'This room no longer exists.', 404)
  }

  if (row.result_status === 'not_participant') {
    throw new RequestError('not_participant', 'You are no longer a participant in this room.', 403)
  }

  return {
    room: await enrichRoom(roomFromRpc(row), code, participantToken),
  }
}

export async function leaveRoom(codeValue, tokenValue) {
  const code = validateCode(codeValue)
  const participantToken = validateToken(tokenValue)
  const row = await callRoomRpc('leave_playlist_room', {
    p_code: code,
    p_participant_token: participantToken,
  })

  return {
    left: row.result_status === 'left',
    room: row.participants_count > 0 ? roomFromRpc(row) : null,
  }
}

export async function heartbeatRoom(codeValue, tokenValue) {
  const code = validateCode(codeValue)
  const participantToken = validateToken(tokenValue)
  const row = await callRoomRpc('heartbeat_playlist_room', {
    p_code: code,
    p_participant_token: participantToken,
  })

  if (row.result_status === 'not_found') {
    throw new RequestError('room_not_found', 'This room no longer exists.', 404)
  }

  if (row.result_status === 'not_participant') {
    throw new RequestError('not_participant', 'You are no longer a participant in this room.', 403)
  }

  return {
    room: await enrichRoom(roomFromRpc(row), code, participantToken),
  }
}
