import { useState } from 'react'
import { CopyButton } from './CopyButton.jsx'
import { CheckIcon, MusicIcon, SpotifyIcon } from './Icons.jsx'

const EMPTY_STATUS = {
  pending: 0,
  added: 0,
  notFound: 0,
}

function StatusMetric({ value, label, tone }) {
  return (
    <div className={`sync-metric ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function EndpointValue({ label, value }) {
  return (
    <div className="sync-endpoint-value">
      <span>{label}</span>
      <div>
        <code>{value}</code>
        <CopyButton value={value} compact ariaLabel={`Copy ${label.toLowerCase()}`} />
      </div>
    </div>
  )
}

export function SpotifyAppleSyncCard({ currentRole, spotify, apple, status }) {
  const [showInstructions, setShowInstructions] = useState(false)
  const ready = Boolean(spotify.connected && spotify.playlist && apple.verified)

  if (!ready) return null

  const counts = { ...EMPTY_STATUS, ...status }
  const pendingEndpoint = `${window.location.origin}/.netlify/functions/apple-sync-pending`
  const reportEndpoint = `${window.location.origin}/.netlify/functions/apple-sync-report`
  const isAppleParticipant = currentRole === 'apple_music'

  return (
    <section className="sync-card" aria-labelledby="sync-card-title">
      <div className="sync-card-heading">
        <div>
          <span className="sync-ready-label"><CheckIcon /> Ready to sync</span>
          <h2 id="sync-card-title">Spotify to Apple Music</h2>
          <p>Add new source tracks by running the Shortcut on your iPhone.</p>
        </div>
      </div>

      <div className="sync-route" aria-label="Spotify playlist flows to the Apple Music Shortcut">
        <div className="sync-route-side spotify">
          <span><SpotifyIcon /></span>
          <div>
            <small>Spotify</small>
            <strong>{spotify.playlist.name}</strong>
          </div>
        </div>
        <span className="sync-route-arrow" aria-hidden="true">↓</span>
        <div className="sync-route-side apple">
          <span><MusicIcon /></span>
          <div>
            <small>Apple Music</small>
            <strong>Shortcut ready</strong>
          </div>
        </div>
      </div>

      <div className="sync-metrics" aria-label="Synchronization progress">
        <StatusMetric value={counts.added} label="Synced" tone="added" />
        <StatusMetric value={counts.pending} label="Pending" tone="pending" />
        <StatusMetric value={counts.notFound} label="Not found" tone="not-found" />
      </div>

      {isAppleParticipant ? (
        <div className="sync-shortcut-action">
          <p>
            Your Shortcut performs the Apple Music search and writes each result to the fixed playlist you chose inside Shortcuts.
          </p>
          <button
            className="button button-secondary sync-instructions-button"
            type="button"
            aria-expanded={showInstructions}
            onClick={() => setShowInstructions((visible) => !visible)}
          >
            {showInstructions ? 'Hide Shortcut Steps' : 'Run Your Playlist Bridge Shortcut'}
          </button>

          {showInstructions && (
            <div className="sync-instructions-panel">
              <p>Open Shortcuts on your iPhone and run Playlist Bridge manually. Use these endpoints when building or updating it:</p>
              <div className="sync-endpoints">
                <EndpointValue label="Pending tracks endpoint" value={pendingEndpoint} />
                <EndpointValue label="Report result endpoint" value={reportEndpoint} />
              </div>
              <p className="sync-token-note">
                Keep using the bridge token saved in your Shortcut as the <code>Authorization: Bearer</code> credential. It is not shown again here.
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="sync-partner-note">
          Your Apple Music partner runs the Shortcut. Progress updates here as each track is reported.
        </p>
      )}

      <p className="sync-mvp-note">
        This MVP adds new unique tracks only. It does not remove or reorder Apple Music songs.
      </p>
    </section>
  )
}
