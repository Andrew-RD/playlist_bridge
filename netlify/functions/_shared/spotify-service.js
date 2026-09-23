import { randomUUID } from 'node:crypto'
import { RequestError } from './http.js'
import {
  buildSpotifyAuthorizationUrl,
  exchangeSpotifyAuthorizationCode,
  getSpotifyConfig,
  requestSpotifyProfile,
  spotifyApiRequest,
} from './spotify-client.js'
import { encryptToken } from './token-crypto.js'
import { firstRpcRow, getSupabase } from './supabase.js'
import {
  isValidParticipantToken,
  isValidRoomCode,
  normalizeRoomCode,
} from './validation.js'

const OAUTH_STATE_LIFETIME_MS = 10 * 60 * 1000
const SPOTIFY_PLAYLIST_ID_PATTERN = /^[A-Za-z0-9]{1,128}$/
const MAX_PLAYLIST_PAGES = 20

function validatedRoomCredentials(codeValue, tokenValue) {
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

function throwMembershipError(status) {
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

  if (status === 'wrong_role') {
    throw new RequestError(
      'spotify_role_required',
      'Only the Spotify participant can manage Spotify for this room.',
      403,
    )
  }
}

async function rpcRow(name, params) {
  const { data, error } = await getSupabase().rpc(name, params)

  if (error) throw error

  const row = firstRpcRow(data)
  if (!row) throw new Error(`Spotify RPC ${name} returned no data`)
  return row
}

export async function resolveSpotifyParticipant(codeValue, tokenValue) {
  const { code, participantToken } = validatedRoomCredentials(codeValue, tokenValue)
  const row = await rpcRow('resolve_spotify_participant', {
    p_code: code,
    p_participant_token: participantToken,
  })

  throwMembershipError(row.result_status)

  return {
    code,
    participantToken,
    roomId: row.resolved_room_id,
    participantId: row.resolved_participant_id,
  }
}

export async function beginSpotifyOAuth(codeValue, tokenValue) {
  const { code, participantToken } = validatedRoomCredentials(codeValue, tokenValue)
  const state = randomUUID()
  const expiresAt = new Date(Date.now() + OAUTH_STATE_LIFETIME_MS).toISOString()
  const row = await rpcRow('begin_spotify_oauth', {
    p_code: code,
    p_participant_token: participantToken,
    p_state: state,
    p_expires_at: expiresAt,
  })

  throwMembershipError(row.result_status)

  if (row.result_status === 'already_connected') {
    throw new RequestError(
      'spotify_already_connected',
      'Spotify is already connected by the other room participant.',
      409,
    )
  }

  return buildSpotifyAuthorizationUrl(state)
}

export async function consumeSpotifyOAuthState(stateValue) {
  if (!isValidParticipantToken(stateValue)) {
    throw new RequestError('invalid_oauth_state', 'The Spotify sign-in request is invalid.', 400)
  }

  const row = await rpcRow('consume_spotify_oauth_state', {
    p_state: stateValue,
  })

  if (row.result_status !== 'consumed') {
    throw new RequestError(
      'invalid_oauth_state',
      'The Spotify sign-in request has expired or was already used.',
      400,
    )
  }

  return {
    code: row.room_code,
    roomId: row.resolved_room_id,
    participantId: row.resolved_participant_id,
  }
}

export async function completeSpotifyConnection(context, authorizationCode) {
  if (typeof authorizationCode !== 'string' || !authorizationCode || authorizationCode.length > 2048) {
    throw new RequestError(
      'invalid_authorization_code',
      'Spotify did not provide a valid authorization code.',
    )
  }

  const tokenData = await exchangeSpotifyAuthorizationCode(authorizationCode)
  const profile = await requestSpotifyProfile(tokenData.access_token)
  const spotifyAccountId = profile.account_id || profile.id

  if (!spotifyAccountId) {
    throw new RequestError(
      'spotify_profile_invalid',
      'Spotify did not return a usable account profile.',
      502,
    )
  }

  let encryptedRefreshToken

  if (tokenData.refresh_token) {
    encryptedRefreshToken = encryptToken(tokenData.refresh_token)
  } else {
    const { data, error } = await getSupabase()
      .from('spotify_connections')
      .select('encrypted_refresh_token')
      .eq('room_id', context.roomId)
      .eq('participant_id', context.participantId)
      .maybeSingle()

    if (error) throw error
    encryptedRefreshToken = data?.encrypted_refresh_token
  }

  if (!encryptedRefreshToken) {
    throw new RequestError(
      'spotify_authorization_failed',
      'Spotify did not provide a refresh token. Please authorize again.',
      502,
    )
  }

  const expiresAt = new Date(
    Date.now() + Number(tokenData.expires_in) * 1000,
  ).toISOString()
  const row = await rpcRow('save_spotify_connection', {
    p_room_id: context.roomId,
    p_participant_id: context.participantId,
    p_spotify_account_id: String(spotifyAccountId),
    p_spotify_user_id: profile.id ? String(profile.id) : null,
    p_spotify_display_name: profile.display_name
      ? String(profile.display_name).slice(0, 500)
      : null,
    p_encrypted_access_token: encryptToken(tokenData.access_token),
    p_encrypted_refresh_token: encryptedRefreshToken,
    p_token_expires_at: expiresAt,
    p_scopes: String(tokenData.scope || '')
      .split(' ')
      .filter(Boolean),
  })

  throwMembershipError(row.result_status)

  if (row.result_status === 'already_connected') {
    throw new RequestError(
      'spotify_already_connected',
      'Spotify was connected by the other room participant.',
      409,
    )
  }
}

function mapSpotifyState(row) {
  return {
    connected: Boolean(row.connected),
    canManage: Boolean(row.can_manage),
    displayName: row.spotify_display_name || null,
    playlist: row.spotify_playlist_id
      ? {
          id: row.spotify_playlist_id,
          name: row.playlist_name,
          ownerDisplayName: row.owner_display_name || null,
          externalUrl: row.spotify_url || null,
          public: row.playlist_is_public,
          collaborative: Boolean(row.playlist_collaborative),
        }
      : null,
  }
}

export async function getSpotifyRoomState(codeValue, tokenValue) {
  const { code, participantToken } = validatedRoomCredentials(codeValue, tokenValue)
  const row = await rpcRow('get_spotify_room_state', {
    p_code: code,
    p_participant_token: participantToken,
  })

  throwMembershipError(row.result_status)
  return mapSpotifyState(row)
}

function mapPlaylist(item, spotifyUserId) {
  const ownerId = item.owner?.id || null
  const collaborative = Boolean(item.collaborative)

  return {
    id: item.id,
    name: item.name || 'Untitled playlist',
    ownerDisplayName: item.owner?.display_name || null,
    public: item.public,
    collaborative,
    externalUrl: item.external_urls?.spotify || null,
    totalItems: item.items?.total ?? null,
    usable: collaborative || Boolean(spotifyUserId && ownerId === spotifyUserId),
  }
}

export async function listSpotifyPlaylists(codeValue, tokenValue) {
  const context = await resolveSpotifyParticipant(codeValue, tokenValue)
  const playlists = []
  let offset = 0
  let hasNextPage = true
  let connection
  let pageCount = 0

  while (hasNextPage && pageCount < MAX_PLAYLIST_PAGES) {
    const result = await spotifyApiRequest(
      context,
      `/me/playlists?limit=50&offset=${offset}`,
    )
    const pageItems = Array.isArray(result.data.items) ? result.data.items : []
    connection = result.connection
    playlists.push(
      ...pageItems
        .filter((item) => item?.id)
        .map((item) => mapPlaylist(item, connection.spotify_user_id)),
    )
    hasNextPage = Boolean(result.data.next) && pageItems.length > 0
    offset += pageItems.length
    pageCount += 1
  }

  return {
    playlists,
    truncated: hasNextPage,
  }
}

export async function selectSpotifyPlaylist(codeValue, tokenValue, playlistIdValue) {
  if (
    typeof playlistIdValue !== 'string'
    || !SPOTIFY_PLAYLIST_ID_PATTERN.test(playlistIdValue)
  ) {
    throw new RequestError(
      'invalid_playlist_id',
      'Choose a valid Spotify playlist.',
    )
  }

  const context = await resolveSpotifyParticipant(codeValue, tokenValue)
  const playlistId = playlistIdValue
  const encodedPlaylistId = encodeURIComponent(playlistId)
  await spotifyApiRequest(
    context,
    `/playlists/${encodedPlaylistId}/items?limit=1&offset=0`,
    {
      forbiddenMessage:
        'Spotify only allows this app to use playlists you own or collaborate on.',
    },
  )
  const { data: playlist } = await spotifyApiRequest(
    context,
    `/playlists/${encodedPlaylistId}`,
    {
      forbiddenMessage:
        'Spotify did not allow access to that playlist.',
    },
  )

  if (!playlist?.id || !playlist?.name) {
    throw new RequestError(
      'spotify_invalid_response',
      'Spotify returned incomplete playlist information. Please try again.',
      502,
    )
  }

  const row = await rpcRow('select_spotify_playlist', {
    p_code: context.code,
    p_participant_token: context.participantToken,
    p_spotify_playlist_id: String(playlist.id),
    p_playlist_name: String(playlist.name).slice(0, 500),
    p_owner_display_name: playlist.owner?.display_name
      ? String(playlist.owner.display_name).slice(0, 500)
      : null,
    p_spotify_url: playlist.external_urls?.spotify || null,
    p_is_public: playlist.public ?? null,
    p_collaborative: Boolean(playlist.collaborative),
  })

  throwMembershipError(row.result_status)

  if (row.result_status === 'not_connected') {
    throw new RequestError(
      'spotify_not_connected',
      'Connect Spotify before choosing a playlist.',
      409,
    )
  }

  if (row.result_status === 'not_spotify_participant') {
    throw new RequestError(
      'spotify_already_connected',
      'The other room participant owns the Spotify connection.',
      403,
    )
  }

  return getSpotifyRoomState(context.code, context.participantToken)
}

export function spotifyRoomReturnUrl(roomCode, indicator) {
  const { parsedRedirectUri } = getSpotifyConfig()
  const url = new URL(`/room/${roomCode}`, parsedRedirectUri.origin)
  url.searchParams.set('spotify', indicator)
  return url.toString()
}

export function spotifyRootReturnUrl(indicator) {
  const { parsedRedirectUri } = getSpotifyConfig()
  const url = new URL('/', parsedRedirectUri.origin)
  url.searchParams.set('spotify', indicator)
  return url.toString()
}
