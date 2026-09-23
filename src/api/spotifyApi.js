import { postFunction } from './roomApi.js'

export const SPOTIFY_LOGIN_ENDPOINT = '/.netlify/functions/spotify-login'

export function getSpotifyStatus(code, participantToken, options) {
  return postFunction('spotify-status', { code, participantToken }, options)
}

export function getSpotifyPlaylists(code, participantToken, options) {
  return postFunction('spotify-playlists', { code, participantToken }, options)
}

export function selectSpotifyPlaylist(
  code,
  participantToken,
  playlistId,
  options,
) {
  return postFunction(
    'spotify-select-playlist',
    { code, participantToken, playlistId },
    options,
  )
}
