import { useState } from 'react'
import { setupAppleShortcut } from '../api/appleShortcutApi.js'
import { CheckIcon, MusicIcon } from './Icons.jsx'
import { CopyButton } from './CopyButton.jsx'

function SetupValue({ label, value, secret = false }) {
  return (
    <div className={`apple-setup-value${secret ? ' secret' : ''}`}>
      <span>{label}</span>
      <div>
        <code>{value}</code>
        <CopyButton value={value} compact ariaLabel={`Copy ${label.toLowerCase()}`} />
      </div>
    </div>
  )
}

export function AppleShortcutCard({
  code,
  participantToken,
  apple,
  appleRolePresent,
  onAppleUpdated,
}) {
  const [setupData, setSetupData] = useState(null)
  const [isSettingUp, setIsSettingUp] = useState(false)
  const [error, setError] = useState('')

  async function handleSetup() {
    if (isSettingUp) return

    if (apple.configured && !window.confirm(
      'Generate a new bridge token? The previous Shortcut token will stop working.',
    )) return

    setIsSettingUp(true)
    setError('')

    try {
      const result = await setupAppleShortcut(code, participantToken)
      setSetupData(result)
      onAppleUpdated(result.apple)
    } catch (requestError) {
      setError(requestError.message || 'Couldn’t configure the Shortcut bridge.')
    } finally {
      setIsSettingUp(false)
    }
  }

  let statusCopy = 'Shortcut not configured'

  if (!appleRolePresent) statusCopy = 'Waiting for the Apple Music side'
  else if (apple.verified) statusCopy = 'Shortcut ready'
  else if (apple.configured) statusCopy = 'Waiting for Shortcut verification'

  return (
    <section className="apple-card" aria-labelledby="apple-card-title">
      <div className="apple-card-head">
        <span className="apple-card-icon"><MusicIcon /></span>
        <div>
          <h2 id="apple-card-title">Apple Music</h2>
          <p>{statusCopy}</p>
        </div>
        {apple.verified && (
          <span className="apple-ready-pill"><CheckIcon /> Shortcut ready</span>
        )}
      </div>

      {apple.canManage ? (
        <div className="apple-card-content">
          {apple.verified ? (
            <p className="apple-status-copy">The Apple Music Shortcut bridge has been verified.</p>
          ) : apple.configured ? (
            <p className="apple-status-copy">
              Run the verification request from Shortcuts. If you no longer have the token, generate a new one.
            </p>
          ) : (
            <p className="apple-status-copy">
              Create credentials for the Shortcut that will represent the Apple Music side.
            </p>
          )}

          {!setupData && (
            <button
              className="button button-secondary apple-setup-button"
              type="button"
              onClick={handleSetup}
              disabled={isSettingUp}
              aria-busy={isSettingUp}
            >
              {isSettingUp
                ? 'Generating…'
                : apple.configured
                  ? 'Generate New Token'
                  : 'Set Up Apple Music'}
            </button>
          )}

          {setupData && (
            <div className="apple-setup-panel">
              <div className="apple-setup-heading">
                <div>
                  <h3>Shortcut verification</h3>
                  <p>The bridge token is shown only during setup. Treat it like a password.</p>
                </div>
                <button
                  className="playlist-close"
                  type="button"
                  onClick={() => setSetupData(null)}
                  aria-label="Hide Shortcut credentials"
                >×</button>
              </div>

              <ol className="apple-setup-steps">
                <li>Open Shortcuts on iPhone.</li>
                <li>Create or open the Playlist Bridge Shortcut.</li>
                <li>Add a URL and a Get Contents of URL action.</li>
                <li>Paste the endpoint and set the request method to GET.</li>
                <li>Add an <code>Authorization</code> header with the value <code>Bearer &lt;bridge token&gt;</code>, then run it.</li>
              </ol>

              <div className="apple-setup-values">
                <SetupValue label="Room code" value={setupData.roomCode} />
                <SetupValue label="Verification endpoint" value={setupData.endpoint} />
                <SetupValue label="Bridge token" value={setupData.bridgeToken} secret />
              </div>

              <button
                className="button button-secondary apple-regenerate-button"
                type="button"
                onClick={handleSetup}
                disabled={isSettingUp}
              >
                {isSettingUp ? 'Generating…' : 'Generate New Token'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="apple-partner-copy">
          {apple.verified
            ? 'Your room partner manages the Apple Music Shortcut.'
            : appleRolePresent
              ? 'Waiting for the Apple Music participant to configure their Shortcut.'
              : 'The future Apple Music participant will configure the Shortcut bridge here.'}
        </p>
      )}

      {error && <p className="form-error apple-error" role="alert">{error}</p>}
    </section>
  )
}
