import { useState } from 'react'
import { claimPlatformRole } from '../api/platformApi.js'
import { MusicIcon, SpotifyIcon } from './Icons.jsx'

const ROLE_DETAILS = {
  spotify: {
    label: 'Spotify',
    description: 'Connect and choose the source playlist.',
    icon: SpotifyIcon,
  },
  apple_music: {
    label: 'Apple Music',
    description: 'Configure the Shortcut bridge.',
    icon: MusicIcon,
  },
}

function RoleIdentity({ label, role, waiting = false }) {
  const details = role ? ROLE_DETAILS[role] : null
  const Icon = details?.icon

  return (
    <article className={`role-identity${role ? ` ${role}` : ' waiting'}`}>
      <span className="role-identity-label">{label}</span>
      <div>
        <span className="role-identity-icon">{Icon ? <Icon /> : '—'}</span>
        <div>
          <strong>{details?.label || 'Waiting for partner'}</strong>
          <small>{waiting && role ? `${details.label} is reserved` : details?.description || 'Their side will appear here.'}</small>
        </div>
      </div>
    </article>
  )
}

export function PlatformRoles({
  code,
  participantToken,
  currentRole,
  partnerRole,
  onRolesUpdated,
}) {
  const [claimingRole, setClaimingRole] = useState('')
  const [error, setError] = useState('')
  const availableRoles = partnerRole
    ? [partnerRole === 'spotify' ? 'apple_music' : 'spotify']
    : ['spotify', 'apple_music']

  async function chooseRole(role) {
    if (claimingRole) return

    setClaimingRole(role)
    setError('')

    try {
      const result = await claimPlatformRole(code, participantToken, role)
      onRolesUpdated(result)
    } catch (requestError) {
      setError(requestError.message || 'Couldn’t assign your platform side.')
    } finally {
      setClaimingRole('')
    }
  }

  if (!currentRole) {
    return (
      <section className="role-picker" aria-labelledby="role-picker-title">
        <p className="role-picker-eyebrow">Choose your side</p>
        <h2 id="role-picker-title">What do you use?</h2>
        <p className="role-picker-intro">
          {partnerRole
            ? `Your partner chose ${ROLE_DETAILS[partnerRole].label}. The other side is reserved for you.`
            : 'Each room bridges one Spotify participant with one Apple Music participant.'}
        </p>

        <div className={`role-choice-grid${availableRoles.length === 1 ? ' single' : ''}`}>
          {availableRoles.map((role) => {
            const details = ROLE_DETAILS[role]
            const Icon = details.icon

            return (
              <button
                className={`role-choice ${role}`}
                type="button"
                key={role}
                onClick={() => chooseRole(role)}
                disabled={Boolean(claimingRole)}
                aria-busy={claimingRole === role}
              >
                <span><Icon /></span>
                <div>
                  <strong>{claimingRole === role ? 'Assigning…' : details.label}</strong>
                  <small>{details.description}</small>
                </div>
              </button>
            )
          })}
        </div>

        {error && <p className="form-error role-picker-error" role="alert">{error}</p>}
      </section>
    )
  }

  const reservedPartnerRole = partnerRole || (
    currentRole === 'spotify' ? 'apple_music' : 'spotify'
  )

  return (
    <section className="role-summary" aria-label="Room platform roles">
      <RoleIdentity label="Your side" role={currentRole} />
      <RoleIdentity
        label="Partner"
        role={reservedPartnerRole}
        waiting={!partnerRole}
      />
    </section>
  )
}
