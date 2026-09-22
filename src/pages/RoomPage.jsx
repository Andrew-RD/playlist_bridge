import { Link, useNavigate, useParams } from 'react-router-dom'
import { BackLink } from '../components/BackLink.jsx'
import { CopyButton } from '../components/CopyButton.jsx'
import { InfoIcon, LeaveIcon, UserIcon } from '../components/Icons.jsx'
import { RoomCodeCard } from '../components/RoomCodeCard.jsx'
import { getRoom, leaveRoom, normalizeRoomCode } from '../utils/roomStorage.js'

function ParticipantSlot({ number, occupied }) {
  return (
    <article className="participant-slot">
      <span className={`participant-avatar${occupied ? '' : ' empty'}`}><UserIcon /></span>
      <div>
        <h3>Participant {number}</h3>
        <p>{occupied ? 'Joined the room' : 'Waiting to join'}</p>
      </div>
      <span className={`slot-state${occupied ? '' : ' empty'}`} aria-label={occupied ? 'Joined' : 'Empty'} />
    </article>
  )
}

export function RoomPage() {
  const { code: codeParam = '' } = useParams()
  const navigate = useNavigate()
  const code = normalizeRoomCode(codeParam)
  const room = getRoom(code)

  function handleLeaveRoom() {
    const confirmed = window.confirm(
      'Leave this room? Your spot will become available to someone else.',
    )

    if (!confirmed) return

    leaveRoom(code)
    navigate('/', { replace: true })
  }

  if (!room) {
    return (
      <div className="page flow-page">
        <div className="flow-wrap">
          <BackLink />
          <div className="glass-card empty-room">
            <h1>Room not found</h1>
            <p>This room doesn’t exist on this device, or its code may be incorrect.</p>
            <Link className="button button-primary" to="/join">Try another code</Link>
          </div>
        </div>
      </div>
    )
  }

  const isFull = room.participantsCount >= room.maxParticipants

  return (
    <div className="page room-page">
      <div className="room-wrap">
        <div className="room-heading-row">
          <div>
            <p className="page-eyebrow">Playlist room</p>
            <h1 className="page-heading">Your bridge</h1>
            <p className="page-intro">{isFull ? 'Room full — both participants are connected.' : 'Waiting for the second person to join.'}</p>
          </div>
          <span className={`status-badge${isFull ? ' full' : ''}`}>{isFull ? 'Both participants connected' : 'Waiting for second person'}</span>
        </div>

        <div className="glass-card">
          <div className="room-overview">
            <RoomCodeCard code={room.code} />
            <div className="participant-count">
              <strong>{room.participantsCount} of {room.maxParticipants}</strong>
              Participant limit
            </div>
          </div>

          <div className="participants-grid">
            <ParticipantSlot number="1" occupied />
            <ParticipantSlot number="2" occupied={room.participantsCount > 1} />
          </div>

          <div className="future-note">
            <InfoIcon />
            <span>Soon, this is where each person will connect Spotify or Apple Music and choose a playlist to sync.</span>
          </div>

          <div className="room-actions">
            <CopyButton value={room.code} />
            <button className="button button-leave" type="button" onClick={handleLeaveRoom}>
              <LeaveIcon /> Leave Room
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
