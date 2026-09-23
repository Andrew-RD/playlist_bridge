import { RequestError } from './http.js'
import { firstRpcRow, getSupabase } from './supabase.js'
import {
  isValidParticipantToken,
  isValidRoomCode,
  normalizeRoomCode,
} from './validation.js'

const PLATFORM_ROLES = new Set(['spotify', 'apple_music'])

function validateCredentials(codeValue, tokenValue) {
  const code = normalizeRoomCode(codeValue)

  if (!isValidRoomCode(code)) {
    throw new RequestError('invalid_room_code', 'Enter a valid 6-character room code.')
  }

  if (!isValidParticipantToken(tokenValue)) {
    throw new RequestError(
      'invalid_participant_token',
      'The participant token is invalid.',
    )
  }

  return { code, participantToken: tokenValue }
}

function throwStateError(status) {
  if (status === 'not_found') {
    throw new RequestError('room_not_found', 'This room no longer exists.', 404)
  }

  if (status === 'not_participant') {
    throw new RequestError(
      'not_participant',
      'You are no longer a participant in this room.',
      403,
    )
  }
}

function mapPlatformState(row) {
  const currentRole = row.current_role || null

  return {
    currentParticipant: { role: currentRole },
    partner: { role: row.partner_role || null },
    rolesAssigned: Boolean(row.roles_assigned),
    apple: {
      configured: Boolean(row.apple_configured),
      verified: Boolean(row.apple_verified),
      canManage: currentRole === 'apple_music',
    },
  }
}

async function platformRpc(name, params) {
  const { data, error } = await getSupabase().rpc(name, params)

  if (error) throw error

  const row = firstRpcRow(data)
  if (!row) throw new Error(`Platform RPC ${name} returned no data`)
  return row
}

export async function getPlatformRoomState(codeValue, tokenValue) {
  const { code, participantToken } = validateCredentials(codeValue, tokenValue)
  const row = await platformRpc('get_platform_room_state', {
    p_code: code,
    p_participant_token: participantToken,
  })

  throwStateError(row.result_status)
  return mapPlatformState(row)
}

export async function claimPlatformRole(codeValue, tokenValue, roleValue) {
  const { code, participantToken } = validateCredentials(codeValue, tokenValue)

  if (!PLATFORM_ROLES.has(roleValue)) {
    throw new RequestError(
      'invalid_platform_role',
      'Choose Spotify or Apple Music.',
    )
  }

  const row = await platformRpc('claim_platform_role', {
    p_code: code,
    p_participant_token: participantToken,
    p_platform_role: roleValue,
  })

  throwStateError(row.result_status)

  if (row.result_status === 'role_taken') {
    throw new RequestError(
      'platform_role_taken',
      'That side was just claimed. The other platform is reserved for you.',
      409,
    )
  }

  if (row.result_status === 'role_locked') {
    throw new RequestError(
      'platform_role_locked',
      'Your platform side has already been assigned for this room.',
      409,
    )
  }

  return mapPlatformState(row)
}

export { mapPlatformState, platformRpc, throwStateError, validateCredentials }
