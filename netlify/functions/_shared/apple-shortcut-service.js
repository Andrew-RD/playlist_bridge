import { createHash, randomBytes } from 'node:crypto'
import { RequestError } from './http.js'
import {
  getPlatformRoomState,
  platformRpc,
  throwStateError,
  validateCredentials,
} from './platform-service.js'

const BRIDGE_TOKEN_PATTERN = /^pb_[A-Za-z0-9_-]{43}$/

function hashBridgeToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function bridgeTokenHashFromAuthorization(authorizationValue) {
  const match = typeof authorizationValue === 'string'
    ? authorizationValue.match(/^Bearer ([^\s]+)$/i)
    : null
  const bridgeToken = match?.[1]

  if (!bridgeToken || !BRIDGE_TOKEN_PATTERN.test(bridgeToken)) {
    throw new RequestError(
      'invalid_bridge_token',
      'The bridge token is invalid or no longer active.',
      401,
    )
  }

  return hashBridgeToken(bridgeToken)
}

function createBridgeToken() {
  return `pb_${randomBytes(32).toString('base64url')}`
}

export async function configureAppleShortcut(
  codeValue,
  tokenValue,
  endpoint,
) {
  const { code, participantToken } = validateCredentials(codeValue, tokenValue)
  const bridgeToken = createBridgeToken()
  const row = await platformRpc('configure_apple_shortcut', {
    p_code: code,
    p_participant_token: participantToken,
    p_token_hash: hashBridgeToken(bridgeToken),
  })

  throwStateError(row.result_status)

  if (row.result_status === 'wrong_role') {
    throw new RequestError(
      'apple_role_required',
      'Only the Apple Music participant can configure the Shortcut bridge.',
      403,
    )
  }

  return {
    roomCode: row.room_code,
    bridgeToken,
    endpoint,
    apple: {
      configured: true,
      verified: false,
      canManage: true,
    },
  }
}

export async function verifyAppleShortcut(authorizationValue) {
  const row = await platformRpc('verify_apple_shortcut', {
    p_token_hash: bridgeTokenHashFromAuthorization(authorizationValue),
  })

  if (row.result_status !== 'verified') {
    throw new RequestError(
      'invalid_bridge_token',
      'The bridge token is invalid or no longer active.',
      401,
    )
  }

  return {
    ok: true,
    roomCode: row.room_code,
    message: 'Playlist Bridge Shortcut connected.',
  }
}

export async function getAppleShortcutStatus(codeValue, tokenValue) {
  const state = await getPlatformRoomState(codeValue, tokenValue)

  return {
    configured: state.apple.configured,
    verified: state.apple.verified,
  }
}
