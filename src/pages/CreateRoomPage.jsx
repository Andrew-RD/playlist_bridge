import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BackLink } from '../components/BackLink.jsx'
import { ArrowRightIcon, CheckIcon, LinkIcon, PlusIcon } from '../components/Icons.jsx'
import { RoomCodeCard } from '../components/RoomCodeCard.jsx'
import { createRoom } from '../utils/roomStorage.js'

export function CreateRoomPage() {
  const [room, setRoom] = useState(null)

  return (
    <div className="page flow-page">
      <div className="flow-wrap">
        <BackLink />
        <p className="page-eyebrow">Start a bridge</p>
        <h1 className="page-heading">Create a room</h1>
        <p className="page-intro">
          Reserve a private two-person space. You’ll get a code to share with the
          person on the other platform.
        </p>

        {!room ? (
          <div className="glass-card action-card create-prompt">
            <span className="card-icon"><LinkIcon /></span>
            <h2>Your shared space</h2>
            <p>One room, two people, and a single bridge between your playlists.</p>
            <button className="button button-primary button-full flow-action-button" type="button" onClick={() => setRoom(createRoom())}>
              <PlusIcon /> Create Room
            </button>
          </div>
        ) : (
          <div className="glass-card action-card" aria-live="polite">
            <div className="success-head">
              <span className="success-check"><CheckIcon /></span>
              <div>
                <h2>Your room is ready</h2>
                <p>Waiting for one more music lover.</p>
              </div>
            </div>
            <RoomCodeCard code={room.code} />
            <p className="share-hint">Send this code to the second person so they can join.</p>
            <Link className="button button-primary button-full flow-action-button" to={`/room/${room.code}`}>
              Enter Room <ArrowRightIcon />
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
