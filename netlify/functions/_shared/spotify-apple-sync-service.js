import { bridgeTokenHashFromAuthorization } from './apple-shortcut-service.js'
import { RequestError } from './http.js'
import { validateCredentials } from './platform-service.js'
import { spotifyApiRequest } from './spotify-client.js'
import { firstRpcRow, getSupabase } from './supabase.js'
import { isValidUuid } from './validation.js'

const SPOTIFY_PAGE_SIZE = 50
const QUEUE_WRITE_SIZE = 250
const DEFAULT_SHORTCUT_BATCH_SIZE = 20
const REPORTABLE_STATUSES = new Set(['added', 'not_found'])

async function syncRpc(name, params) {
  const { data, error } = await getSupabase().rpc(name, params)

  if (error) throw error

  const row = firstRpcRow(data)
  if (!row) throw new Error(`Sync RPC ${name} returned no data`)
  return row
}

function throwSyncContextError(status) {
  if (status === 'invalid') {
    throw new RequestError(
      'invalid_bridge_token',
      'The bridge token is invalid or no longer active.',
      401,
    )
  }

  if (status === 'shortcut_not_verified') {
    throw new RequestError(
      'shortcut_not_verified',
      'Verify the Playlist Bridge Shortcut before syncing.',
      409,
    )
  }

  if (status === 'spotify_not_connected') {
    throw new RequestError(
      'spotify_not_connected',
      'The Spotify side is not connected yet.',
      409,
    )
  }

  if (status === 'playlist_not_selected') {
    throw new RequestError(
      'spotify_playlist_not_selected',
      'Choose a Spotify playlist before syncing.',
      409,
    )
  }

  if (status !== 'ready') {
    throw new Error(`Unexpected sync context status: ${status}`)
  }
}

async function resolveSyncContext(authorizationValue) {
  const tokenHash = bridgeTokenHashFromAuthorization(authorizationValue)
  const row = await syncRpc('resolve_apple_sync_context', {
    p_token_hash: tokenHash,
  })

  throwSyncContextError(row.result_status)

  if (
    !row.resolved_room_id
    || !row.apple_participant_id
    || !row.spotify_participant_id
    || !row.spotify_playlist_id
  ) {
    throw new Error('Sync context is incomplete')
  }

  return {
    code: row.room_code,
    roomId: row.resolved_room_id,
    spotifyParticipantId: row.spotify_participant_id,
    playlistId: row.spotify_playlist_id,
    playlistName: row.spotify_playlist_name || 'Spotify playlist',
  }
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null
  const cleaned = value.trim().replace(/\s+/g, ' ')
  return cleaned ? cleaned.slice(0, maxLength) : null
}

function mapSpotifyTrack(entry) {
  const track = entry?.item

  if (
    !track
    || track.type !== 'track'
    || entry.is_local
    || track.is_local
    || track.is_playable === false
  ) return null

  const spotifyTrackId = cleanText(track.id, 128)
  const spotifyUri = cleanText(track.uri, 500)
    || (spotifyTrackId ? `spotify:track:${spotifyTrackId}` : null)
  const title = cleanText(track.name, 1000)
  const artists = Array.isArray(track.artists)
    ? track.artists
        .map((artist) => cleanText(artist?.name, 500))
        .filter(Boolean)
        .slice(0, 50)
    : []
  const primaryArtist = artists[0]

  if (!spotifyUri || !title || !primaryArtist) return null

  const album = cleanText(track.album?.name, 1000)
  const queryParts = [title, primaryArtist, album].filter(Boolean)
  const duration = track.duration_ms

  return {
    spotify_uri: spotifyUri,
    spotify_track_id: spotifyTrackId,
    title,
    artists,
    primary_artist: primaryArtist,
    album,
    duration_ms: Number.isSafeInteger(duration) && duration >= 0
      ? duration
      : null,
    spotify_url: cleanText(track.external_urls?.spotify, 2048),
    search_query: queryParts.join(' ').slice(0, 2000),
  }
}

async function fetchSpotifyPlaylistTracks(context) {
  const tracksByUri = new Map()
  const playlistId = encodeURIComponent(context.playlistId)
  let offset = 0

  while (true) {
    const { data } = await spotifyApiRequest(
      {
        roomId: context.roomId,
        participantId: context.spotifyParticipantId,
      },
      `/playlists/${playlistId}/items?limit=${SPOTIFY_PAGE_SIZE}&offset=${offset}`,
      {
        forbiddenMessage:
          'Spotify no longer allows access to the selected playlist. Choose an owned or collaborative playlist.',
      },
    )

    if (!data || !Array.isArray(data.items)) {
      throw new RequestError(
        'spotify_invalid_response',
        'Spotify returned an unexpected playlist response. Please try again.',
        502,
      )
    }

    for (const entry of data.items) {
      const track = mapSpotifyTrack(entry)
      if (track) tracksByUri.set(track.spotify_uri, track)
    }

    if (!data.next) return [...tracksByUri.values()]

    if (data.items.length === 0) {
      throw new RequestError(
        'spotify_invalid_response',
        'Spotify returned incomplete playlist pagination. Please try again.',
        502,
      )
    }

    offset += data.items.length
  }
}

async function refreshSyncQueue(context) {
  const items = await fetchSpotifyPlaylistTracks(context)

  for (let offset = 0; offset < items.length; offset += QUEUE_WRITE_SIZE) {
    const row = await syncRpc('upsert_apple_sync_items', {
      p_room_id: context.roomId,
      p_spotify_playlist_id: context.playlistId,
      p_items: items.slice(offset, offset + QUEUE_WRITE_SIZE),
    })

    if (row.result_status === 'not_found') {
      throw new RequestError(
        'room_not_found',
        'This Playlist Bridge room no longer exists.',
        404,
      )
    }

    if (row.result_status === 'playlist_changed') {
      throw new RequestError(
        'spotify_playlist_changed',
        'The selected Spotify playlist changed. Run the Shortcut again.',
        409,
      )
    }

    if (row.result_status !== 'refreshed') {
      throw new Error(`Unexpected queue refresh status: ${row.result_status}`)
    }
  }
}

function mapPendingItem(item) {
  return {
    syncItemId: item.id,
    spotifyUri: item.spotify_uri,
    title: item.title,
    artist: item.primary_artist,
    artists: Array.isArray(item.artists) ? item.artists : [item.primary_artist],
    album: item.album,
    durationMs: item.duration_ms,
    searchQuery: item.search_query,
    spotifyUrl: item.spotify_url,
  }
}

export async function getPendingAppleSyncItems(authorizationValue) {
  const context = await resolveSyncContext(authorizationValue)
  await refreshSyncQueue(context)

  const currentContext = await resolveSyncContext(authorizationValue)

  if (
    currentContext.roomId !== context.roomId
    || currentContext.playlistId !== context.playlistId
  ) {
    throw new RequestError(
      'spotify_playlist_changed',
      'The selected Spotify playlist changed. Run the Shortcut again.',
      409,
    )
  }

  const { data, error, count } = await getSupabase()
    .from('apple_sync_items')
    .select(
      'id, spotify_uri, title, artists, primary_artist, album, duration_ms, search_query, spotify_url',
      { count: 'exact' },
    )
    .eq('room_id', currentContext.roomId)
    .eq('spotify_playlist_id', currentContext.playlistId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(DEFAULT_SHORTCUT_BATCH_SIZE)

  if (error) throw error

  const pendingItems = Array.isArray(data) ? data : []

  return {
    ok: true,
    roomCode: currentContext.code,
    playlist: { name: currentContext.playlistName },
    items: pendingItems.map(mapPendingItem),
    remaining: Math.max(Number(count || 0) - pendingItems.length, 0),
  }
}

export async function reportAppleSyncItem(
  authorizationValue,
  syncItemIdValue,
  statusValue,
) {
  if (!isValidUuid(syncItemIdValue)) {
    throw new RequestError('invalid_sync_item', 'The sync item ID is invalid.')
  }

  if (!REPORTABLE_STATUSES.has(statusValue)) {
    throw new RequestError(
      'invalid_sync_status',
      'Status must be added or not_found.',
    )
  }

  const tokenHash = bridgeTokenHashFromAuthorization(authorizationValue)
  const row = await syncRpc('report_apple_sync_result', {
    p_token_hash: tokenHash,
    p_sync_item_id: syncItemIdValue,
    p_result_status: statusValue,
  })

  if (row.result_status === 'invalid') {
    throw new RequestError(
      'invalid_bridge_token',
      'The bridge token is invalid or no longer active.',
      401,
    )
  }

  if (row.result_status === 'shortcut_not_verified') {
    throw new RequestError(
      'shortcut_not_verified',
      'Verify the Playlist Bridge Shortcut before reporting sync results.',
      409,
    )
  }

  if (row.result_status === 'item_not_found') {
    throw new RequestError(
      'sync_item_not_found',
      'That sync item does not belong to this room.',
      404,
    )
  }

  if (row.result_status === 'status_conflict') {
    throw new RequestError(
      'sync_item_already_finalized',
      'That sync item has already been reported with a different result.',
      409,
    )
  }

  if (!['reported', 'already_reported'].includes(row.result_status)) {
    throw new Error(`Unexpected sync report status: ${row.result_status}`)
  }

  return {
    ok: true,
    syncItemId: syncItemIdValue,
    status: row.item_status,
    alreadyReported: row.result_status === 'already_reported',
  }
}

export async function getSpotifyAppleSyncStatus(codeValue, tokenValue) {
  const { code, participantToken } = validateCredentials(codeValue, tokenValue)
  const row = await syncRpc('get_spotify_apple_sync_status', {
    p_code: code,
    p_participant_token: participantToken,
  })

  if (row.result_status === 'not_found') {
    throw new RequestError('room_not_found', 'This room no longer exists.', 404)
  }

  if (row.result_status === 'not_participant') {
    throw new RequestError(
      'not_participant',
      'You are no longer a participant in this room.',
      403,
    )
  }

  if (row.result_status !== 'ok') {
    throw new Error(`Unexpected sync status result: ${row.result_status}`)
  }

  return {
    pending: Number(row.pending_count || 0),
    added: Number(row.added_count || 0),
    notFound: Number(row.not_found_count || 0),
  }
}
