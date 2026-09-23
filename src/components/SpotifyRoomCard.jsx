import { useState } from 'react'
import {
  getSpotifyPlaylists,
  selectSpotifyPlaylist,
  SPOTIFY_LOGIN_ENDPOINT,
} from '../api/spotifyApi.js'
import { CheckIcon, SpotifyIcon } from './Icons.jsx'

const OAUTH_NOTICES = {
  connected: ['success', 'Spotify connected successfully.'],
  denied: ['error', 'Spotify authorization was canceled.'],
  error: ['error', 'Couldn’t connect Spotify. Please try again.'],
  already_connected: ['error', 'The other participant connected Spotify first.'],
}

function playlistMeta(playlist) {
  const details = []

  if (playlist.ownerDisplayName) details.push(`By ${playlist.ownerDisplayName}`)
  if (playlist.collaborative) details.push('Collaborative')
  else if (playlist.public === false) details.push('Private')
  else if (playlist.public === true) details.push('Public')
  if (Number.isInteger(playlist.totalItems)) {
    details.push(`${playlist.totalItems} ${playlist.totalItems === 1 ? 'item' : 'items'}`)
  }

  return details.join(' · ')
}

function SpotifyLoginForm({ code, participantToken, label = 'Connect Spotify' }) {
  return (
    <form method="post" action={SPOTIFY_LOGIN_ENDPOINT}>
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="participantToken" value={participantToken} />
      <button className="button spotify-connect-button" type="submit">
        <SpotifyIcon /> {label}
      </button>
    </form>
  )
}

export function SpotifyRoomCard({
  code,
  participantToken,
  spotify,
  oauthResult,
  onSpotifyUpdated,
}) {
  const [playlists, setPlaylists] = useState([])
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [selectingId, setSelectingId] = useState('')
  const [error, setError] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [needsReconnect, setNeedsReconnect] = useState(false)
  const oauthNotice = OAUTH_NOTICES[oauthResult]

  async function openPlaylistPicker() {
    setIsPickerOpen(true)
    setIsLoading(true)
    setError('')

    try {
      const result = await getSpotifyPlaylists(code, participantToken)
      setPlaylists(result.playlists)
      setTruncated(Boolean(result.truncated))
      setNeedsReconnect(false)
    } catch (requestError) {
      setNeedsReconnect(requestError.code === 'spotify_reconnect_required')
      setError(requestError.message || 'Couldn’t load your Spotify playlists.')
    } finally {
      setIsLoading(false)
    }
  }

  async function choosePlaylist(playlist) {
    if (!playlist.usable || selectingId) return

    setSelectingId(playlist.id)
    setError('')

    try {
      const result = await selectSpotifyPlaylist(
        code,
        participantToken,
        playlist.id,
      )
      onSpotifyUpdated(result.spotify)
      setIsPickerOpen(false)
      setNeedsReconnect(false)
    } catch (requestError) {
      setNeedsReconnect(requestError.code === 'spotify_reconnect_required')
      setError(requestError.message || 'Couldn’t select that playlist.')
    } finally {
      setSelectingId('')
    }
  }

  return (
    <section className="spotify-card" aria-labelledby="spotify-card-title">
      <div className="spotify-card-head">
        <span className="spotify-card-icon"><SpotifyIcon /></span>
        <div>
          <h2 id="spotify-card-title">Spotify</h2>
          <p>{spotify.connected ? 'Spotify side connected' : 'Connect the first side of your bridge'}</p>
        </div>
        {spotify.connected && <span className="spotify-connected-pill"><CheckIcon /> Connected</span>}
      </div>

      {oauthNotice && (
        <p className={`spotify-notice ${oauthNotice[0]}`} role="status">
          {oauthNotice[1]}
        </p>
      )}

      {!spotify.connected ? (
        spotify.canManage ? (
          <SpotifyLoginForm code={code} participantToken={participantToken} />
        ) : (
          <p className="spotify-partner-note">
            Waiting for the Spotify participant to connect their account.
          </p>
        )
      ) : (
        <div className="spotify-connected-content">
          <p className="spotify-account">
            Connected as <strong>{spotify.displayName || 'Spotify listener'}</strong>
          </p>

          {spotify.playlist ? (
            <div className="selected-playlist">
              <span className="selected-playlist-check"><CheckIcon /></span>
              <div>
                <span>Selected playlist</span>
                <strong>{spotify.playlist.name}</strong>
                {spotify.playlist.ownerDisplayName && <small>By {spotify.playlist.ownerDisplayName}</small>}
              </div>
            </div>
          ) : (
            <p className="spotify-waiting-copy">
              {spotify.canManage
                ? 'Choose the playlist this room will use.'
                : 'Waiting for the Spotify participant to choose a playlist.'}
            </p>
          )}

          {spotify.canManage && !isPickerOpen && (
            <button className="button button-secondary spotify-picker-button" type="button" onClick={openPlaylistPicker}>
              {spotify.playlist ? 'Change Playlist' : 'Choose Playlist'}
            </button>
          )}

          {!spotify.canManage && (
            <p className="spotify-partner-note">Your room partner manages the Spotify connection.</p>
          )}

          {spotify.canManage && needsReconnect && (
            <SpotifyLoginForm
              code={code}
              participantToken={participantToken}
              label="Reconnect Spotify"
            />
          )}

          {isPickerOpen && (
            <div className="playlist-picker">
              <div className="playlist-picker-head">
                <div>
                  <h3>Choose a playlist</h3>
                  <p>Owned and collaborative playlists are selectable.</p>
                </div>
                <button className="playlist-close" type="button" onClick={() => setIsPickerOpen(false)} aria-label="Close playlist picker">×</button>
              </div>

              {isLoading ? (
                <div className="playlist-loading" role="status"><span className="loading-spinner" />Loading playlists…</div>
              ) : (
                <div className="playlist-list">
                  {playlists.map((playlist) => {
                    const selected = spotify.playlist?.id === playlist.id
                    const selecting = selectingId === playlist.id

                    return (
                      <button
                        className={`playlist-option${selected ? ' selected' : ''}`}
                        type="button"
                        key={playlist.id}
                        onClick={() => choosePlaylist(playlist)}
                        disabled={!playlist.usable || Boolean(selectingId)}
                      >
                        <span className="playlist-option-icon">{selected ? <CheckIcon /> : <SpotifyIcon />}</span>
                        <span className="playlist-option-copy">
                          <strong>{playlist.name}</strong>
                          <small>{playlistMeta(playlist)}</small>
                          {!playlist.usable && <em>Not available to this app</em>}
                        </span>
                        {selecting && <span className="playlist-selecting">Selecting…</span>}
                      </button>
                    )
                  })}

                  {!playlists.length && !error && (
                    <p className="playlist-empty">No Spotify playlists were found.</p>
                  )}
                </div>
              )}

              {truncated && <p className="playlist-footnote">Showing the first 1,000 playlists.</p>}
            </div>
          )}
        </div>
      )}

      {error && <p className="form-error spotify-error" role="alert">{error}</p>}
    </section>
  )
}
