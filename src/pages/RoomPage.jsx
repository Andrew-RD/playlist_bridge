import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CopyButton } from '../components/CopyButton.jsx'
import { AppleShortcutCard } from '../components/AppleShortcutCard.jsx'
import { InfoIcon, LeaveIcon, UserIcon } from '../components/Icons.jsx'
import { PlatformRoles } from '../components/PlatformRoles.jsx'
import { RoomCodeCard } from '../components/RoomCodeCard.jsx'
import { SpotifyRoomCard } from '../components/SpotifyRoomCard.jsx'
import {
  getRoom,
  heartbeatRoom,
  leaveRoom,
  normalizeRoomCode,
} from '../api/roomApi.js'
import {
  getParticipantToken,
  removeParticipantToken,
} from '../utils/roomSession.js'

const POLL_INTERVAL_MS = 3000
const HEARTBEAT_INTERVAL_MS = 25000
const TERMINAL_ROOM_ERRORS = new Set(['room_not_found', 'not_participant'])

function ParticipantSlot({ number, occupied }) {
  return (
    <article className="participant-slot">
      <span className={`participant-avatar${occupied ? '' : ' empty'}`}><UserIcon /></span>
      <div>
        <h3>Participant {number}</h3>
        <p>{occupied ? 'Connected to the room' : 'Waiting to join'}</p>
      </div>
      <span className={`slot-state${occupied ? '' : ' empty'}`} aria-label={occupied ? 'Connected' : 'Empty'} />
    </article>
  )
}

function RoomStateCard({ title, message, children, loading = false }) {
  return (
    <div className="page flow-page">
      <div className="flow-wrap">
        <div className="glass-card empty-room">
          {loading && <span className="loading-spinner" aria-hidden="true" />}
          <h1>{title}</h1>
          <p>{message}</p>
          {children}
        </div>
      </div>
    </div>
  )
}

export function RoomPage() {
  const { code: codeParam = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const code = normalizeRoomCode(codeParam)
  const participantToken = getParticipantToken(code)
  const [room, setRoom] = useState(null)
  const [viewState, setViewState] = useState('loading')
  const [connectionError, setConnectionError] = useState('')
  const [leaveError, setLeaveError] = useState('')
  const [isLeaving, setIsLeaving] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (!participantToken) return undefined

    let active = true
    let terminal = false
    let pollInFlight = false
    let heartbeatInFlight = false
    const controller = new AbortController()

    function handleRequestError(error) {
      if (!active || error.name === 'AbortError') return

      if (TERMINAL_ROOM_ERRORS.has(error.code)) {
        terminal = true
        removeParticipantToken(code)
        setRoom(null)
        setViewState(error.code === 'room_not_found' ? 'not-found' : 'not-participant')
        return
      }

      setConnectionError(error.message || 'Connection lost. Trying again…')
      setViewState((current) => current === 'ready' ? current : 'network-error')
    }

    async function pollRoom() {
      if (terminal || pollInFlight) return
      pollInFlight = true

      try {
        const result = await getRoom(code, participantToken, {
          signal: controller.signal,
        })

        if (!active || terminal) return
        setRoom(result.room)
        setConnectionError('')
        setViewState('ready')
      } catch (error) {
        handleRequestError(error)
      } finally {
        pollInFlight = false
      }
    }

    async function sendHeartbeat() {
      if (terminal || heartbeatInFlight) return
      heartbeatInFlight = true

      try {
        const result = await heartbeatRoom(code, participantToken, {
          signal: controller.signal,
        })

        if (!active || terminal) return
        setRoom(result.room)
        setConnectionError('')
        setViewState('ready')
      } catch (error) {
        handleRequestError(error)
      } finally {
        heartbeatInFlight = false
      }
    }

    void sendHeartbeat()
    const pollTimer = window.setInterval(pollRoom, POLL_INTERVAL_MS)
    const heartbeatTimer = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)

    return () => {
      active = false
      controller.abort()
      window.clearInterval(pollTimer)
      window.clearInterval(heartbeatTimer)
    }
  }, [code, participantToken, retryKey])

  async function handleLeaveRoom() {
    const confirmed = window.confirm(
      'Leave this room? Your spot will become available to someone else.',
    )

    if (!confirmed || !participantToken) return

    setLeaveError('')
    setIsLeaving(true)

    try {
      await leaveRoom(code, participantToken)
      removeParticipantToken(code)
      navigate('/', { replace: true })
    } catch (error) {
      if (TERMINAL_ROOM_ERRORS.has(error.code)) {
        removeParticipantToken(code)
        navigate('/', { replace: true })
        return
      }

      setLeaveError(error.message || 'Couldn’t leave the room. Please try again.')
      setIsLeaving(false)
    }
  }

  if (viewState === 'not-found') {
    return (
      <RoomStateCard title="Room no longer available" message="This room has expired or no longer exists.">
        <Link className="button button-primary" to="/">Return Home</Link>
      </RoomStateCard>
    )
  }

  if (viewState === 'not-participant' || !participantToken) {
    return (
      <RoomStateCard title="You’re no longer in this room" message="Your participant session has ended. You can return home and join again if a slot is available.">
        <Link className="button button-primary" to="/">Return Home</Link>
      </RoomStateCard>
    )
  }

  if (viewState === 'network-error' && !room) {
    return (
      <RoomStateCard title="Can’t reach the room" message={connectionError}>
        <button className="button button-primary" type="button" onClick={() => {
          setViewState('loading')
          setRetryKey((value) => value + 1)
        }}>
          Try Again
        </button>
      </RoomStateCard>
    )
  }

  if (!room) {
    return <RoomStateCard title="Opening your room" message="Connecting to the shared room…" loading />
  }

  const isFull = room.participantsCount >= room.maxParticipants
  const statusText = connectionError
    ? 'Reconnecting…'
    : isFull
      ? 'Both participants connected'
      : 'Waiting for second person'

  return (
    <div className="page room-page">
      <div className="room-wrap">
        <div className="room-heading-row">
          <div>
            <p className="page-eyebrow">Playlist room</p>
            <h1 className="page-heading">Your bridge</h1>
            <p className="page-intro">{isFull ? 'Room full — both participants are connected.' : 'Waiting for the second person to join.'}</p>
          </div>
          <span className={`status-badge${connectionError ? ' offline' : isFull ? ' full' : ''}`}>{statusText}</span>
        </div>

        <div className="glass-card">
          <div className="room-overview">
            <RoomCodeCard code={room.code} />
            <div className="participant-count">
              <strong>{room.participantsCount} of {room.maxParticipants}</strong>
              Active participants
            </div>
          </div>

          <div className="participants-grid">
            <ParticipantSlot number="1" occupied={room.participantsCount > 0} />
            <ParticipantSlot number="2" occupied={room.participantsCount > 1} />
          </div>

          <PlatformRoles
            code={room.code}
            participantToken={participantToken}
            currentRole={room.currentParticipant?.role ?? null}
            partnerRole={room.partner?.role ?? null}
            onRolesUpdated={(platform) => {
              setRoom((current) => ({
                ...current,
                currentParticipant: platform.currentParticipant,
                partner: platform.partner,
                rolesAssigned: platform.rolesAssigned,
                apple: platform.apple,
              }))
            }}
          />

          {room.currentParticipant?.role && (
            <>
              <SpotifyRoomCard
                code={room.code}
                participantToken={participantToken}
                spotify={room.spotify ?? {
                  connected: false,
                  canManage: false,
                  displayName: null,
                  playlist: null,
                }}
                oauthResult={searchParams.get('spotify')}
                onSpotifyUpdated={(spotify) => {
                  setRoom((current) => ({ ...current, spotify }))
                }}
              />

              <AppleShortcutCard
                code={room.code}
                participantToken={participantToken}
                apple={room.apple ?? {
                  configured: false,
                  verified: false,
                  canManage: false,
                }}
                appleRolePresent={[
                  room.currentParticipant?.role,
                  room.partner?.role,
                ].includes('apple_music')}
                onAppleUpdated={(apple) => {
                  setRoom((current) => ({ ...current, apple }))
                }}
              />

              <div className="future-note">
                <InfoIcon />
                <span>Song matching and playlist synchronization come in the next milestone.</span>
              </div>
            </>
          )}

          {connectionError && <p className="connection-notice" role="status">{connectionError}</p>}
          {leaveError && <p className="form-error room-action-error" role="alert">{leaveError}</p>}

          <div className="room-actions">
            <CopyButton value={room.code} />
            <button className="button button-leave" type="button" onClick={handleLeaveRoom} disabled={isLeaving} aria-busy={isLeaving}>
              <LeaveIcon /> {isLeaving ? 'Leaving…' : 'Leave Room'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
