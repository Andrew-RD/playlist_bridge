import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BackLink } from '../components/BackLink.jsx'
import { ArrowRightIcon, InfoIcon } from '../components/Icons.jsx'
import { joinRoom, normalizeRoomCode } from '../utils/roomStorage.js'

export function JoinRoomPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  function handleChange(event) {
    setCode(normalizeRoomCode(event.target.value))
    if (error) setError('')
  }

  function handleSubmit(event) {
    event.preventDefault()

    if (code.length < 6) {
      setError('Enter the complete 6-character room code.')
      return
    }

    const result = joinRoom(code)

    if (!result.ok) {
      setError(result.reason === 'full' ? 'That room is already full.' : 'We couldn’t find that room. Check the code and try again.')
      return
    }

    navigate(`/room/${result.room.code}`)
  }

  return (
    <div className="page flow-page">
      <div className="flow-wrap">
        <BackLink />
        <p className="page-eyebrow">Meet in the middle</p>
        <h1 className="page-heading">Join a room</h1>
        <p className="page-intro">Enter the code shared by the person who created your playlist bridge.</p>

        <form className="glass-card action-card" onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="room-code">Room code</label>
            <input
              className="text-input"
              id="room-code"
              name="room-code"
              type="text"
              value={code}
              onChange={handleChange}
              placeholder="ABC123"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck="false"
              inputMode="text"
              maxLength="6"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'room-code-error' : 'room-code-help'}
              autoFocus
            />
            {error ? (
              <p className="form-error" id="room-code-error" role="alert">{error}</p>
            ) : (
              <p className="form-help" id="room-code-help">Codes use six letters or numbers.</p>
            )}
          </div>
          <button className="button button-primary button-full flow-action-button" type="submit">
            Join Room <ArrowRightIcon />
          </button>
        </form>

        <p className="prototype-note"><InfoIcon /> Rooms are stored on this device for the frontend prototype.</p>
      </div>
    </div>
  )
}
