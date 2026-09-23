import { Buffer } from 'node:buffer'
import { RequestError } from './http.js'
import { decryptToken, encryptToken } from './token-crypto.js'
import { getSupabase } from './supabase.js'

const SPOTIFY_ACCOUNTS_ORIGIN = 'https://accounts.spotify.com'
const SPOTIFY_API_ORIGIN = 'https://api.spotify.com/v1'
const REQUEST_TIMEOUT_MS = 12000
const EXPIRY_BUFFER_MS = 60000

export const SPOTIFY_SCOPES = [
  'user-read-private',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
]

export function getSpotifyConfig() {
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Spotify server environment is not configured')
  }

  let parsedRedirectUri

  try {
    parsedRedirectUri = new URL(redirectUri)
  } catch {
    throw new Error('SPOTIFY_REDIRECT_URI must be an absolute URL')
  }

  if (!['http:', 'https:'].includes(parsedRedirectUri.protocol)) {
    throw new Error('SPOTIFY_REDIRECT_URI must use HTTP or HTTPS')
  }

  return { clientId, clientSecret, redirectUri, parsedRedirectUri }
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch {
    throw new RequestError(
      'spotify_unavailable',
      'Spotify is temporarily unavailable. Please try again.',
      502,
    )
  } finally {
    clearTimeout(timeout)
  }
}

async function parseJson(response) {
  try {
    return await response.json()
  } catch {
    throw new RequestError(
      'spotify_invalid_response',
      'Spotify returned an unexpected response. Please try again.',
      502,
    )
  }
}

function basicAuthorization() {
  const { clientId, clientSecret } = getSpotifyConfig()
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
}

async function requestToken(parameters, failureCode) {
  const response = await fetchWithTimeout(`${SPOTIFY_ACCOUNTS_ORIGIN}/api/token`, {
    method: 'POST',
    headers: {
      authorization: basicAuthorization(),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(parameters),
  })
  const payload = await parseJson(response)

  if (!response.ok || !payload.access_token || !payload.expires_in) {
    if (response.status === 429) {
      throw new RequestError(
        'spotify_rate_limited',
        'Spotify is receiving too many requests. Please wait a moment and try again.',
        429,
      )
    }

    throw new RequestError(
      failureCode,
      failureCode === 'spotify_reconnect_required'
        ? 'Your Spotify connection has expired. Please connect it again.'
        : 'Spotify authorization could not be completed. Please try again.',
      failureCode === 'spotify_reconnect_required' ? 401 : 502,
    )
  }

  return payload
}

export function buildSpotifyAuthorizationUrl(state) {
  const { clientId, redirectUri } = getSpotifyConfig()
  const url = new URL('/authorize', SPOTIFY_ACCOUNTS_ORIGIN)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: SPOTIFY_SCOPES.join(' '),
  }).toString()
  return url.toString()
}

export function exchangeSpotifyAuthorizationCode(code) {
  const { redirectUri } = getSpotifyConfig()
  return requestToken(
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    },
    'spotify_authorization_failed',
  )
}

function refreshSpotifyAccessToken(refreshToken) {
  return requestToken(
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
    'spotify_reconnect_required',
  )
}

async function spotifyResponse(accessToken, path) {
  return fetchWithTimeout(`${SPOTIFY_API_ORIGIN}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
}

async function parseSpotifyApiResponse(response, forbiddenMessage) {
  if (response.status === 401) return { unauthorized: true }

  if (response.status === 403) {
    throw new RequestError(
      'spotify_forbidden',
      forbiddenMessage || 'Spotify did not allow access to this resource.',
      403,
    )
  }

  if (response.status === 404) {
    throw new RequestError(
      'spotify_not_found',
      'That Spotify playlist could not be found.',
      404,
    )
  }

  if (response.status === 429) {
    throw new RequestError(
      'spotify_rate_limited',
      'Spotify is receiving too many requests. Please wait a moment and try again.',
      429,
    )
  }

  if (!response.ok) {
    throw new RequestError(
      'spotify_api_error',
      'Spotify could not complete that request. Please try again.',
      502,
    )
  }

  return { data: await parseJson(response) }
}

export async function requestSpotifyProfile(accessToken) {
  const response = await spotifyResponse(accessToken, '/me')
  const result = await parseSpotifyApiResponse(response)

  if (result.unauthorized) {
    throw new RequestError(
      'spotify_authorization_failed',
      'Spotify authorization could not be completed. Please try again.',
      401,
    )
  }

  return result.data
}

async function loadConnection(context) {
  const { data, error } = await getSupabase()
    .from('spotify_connections')
    .select('*')
    .eq('room_id', context.roomId)
    .eq('participant_id', context.participantId)
    .maybeSingle()

  if (error) throw error

  if (!data) {
    throw new RequestError(
      'spotify_not_connected',
      'Connect Spotify before choosing a playlist.',
      409,
    )
  }

  return data
}

async function validAccessToken(context, forceRefresh = false) {
  const connection = await loadConnection(context)
  const expiresAt = new Date(connection.token_expires_at).getTime()

  if (!forceRefresh && expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
    return {
      accessToken: decryptToken(connection.encrypted_access_token),
      connection,
    }
  }

  const refreshToken = decryptToken(connection.encrypted_refresh_token)
  const refreshed = await refreshSpotifyAccessToken(refreshToken)
  const encryptedRefreshToken = refreshed.refresh_token
    ? encryptToken(refreshed.refresh_token)
    : connection.encrypted_refresh_token
  const tokenExpiresAt = new Date(
    Date.now() + Number(refreshed.expires_in) * 1000,
  ).toISOString()
  const { error } = await getSupabase()
    .from('spotify_connections')
    .update({
      encrypted_access_token: encryptToken(refreshed.access_token),
      encrypted_refresh_token: encryptedRefreshToken,
      token_expires_at: tokenExpiresAt,
      scopes: refreshed.scope
        ? refreshed.scope.split(' ').filter(Boolean)
        : connection.scopes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connection.id)

  if (error) throw error

  return {
    accessToken: refreshed.access_token,
    connection: {
      ...connection,
      encrypted_access_token: null,
      encrypted_refresh_token: null,
      token_expires_at: tokenExpiresAt,
      scopes: refreshed.scope
        ? refreshed.scope.split(' ').filter(Boolean)
        : connection.scopes,
    },
  }
}

export async function spotifyApiRequest(context, path, options = {}) {
  let credentials = await validAccessToken(context)
  let response = await spotifyResponse(credentials.accessToken, path)
  let result = await parseSpotifyApiResponse(response, options.forbiddenMessage)

  if (result.unauthorized) {
    credentials = await validAccessToken(context, true)
    response = await spotifyResponse(credentials.accessToken, path)
    result = await parseSpotifyApiResponse(response, options.forbiddenMessage)
  }

  if (result.unauthorized) {
    throw new RequestError(
      'spotify_reconnect_required',
      'Your Spotify connection has expired. Please connect it again.',
      401,
    )
  }

  return { data: result.data, connection: credentials.connection }
}
