import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BackLink } from '../components/BackLink.jsx'
import { ArrowRightIcon, InfoIcon } from '../components/Icons.jsx'
import { joinRoom, normalizeRoomCode } from '../api/roomApi.js'
import { getParticipantToken, saveParticipantToken } from '../utils/roomSession.js'

export function JoinRoomPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [isJoining, setIsJoining] = useState(false)
  const navigate = useNavigate()

  function handleChange(event) {
    setCode(normalizeRoomCode(event.target.value))
    if (error) setError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (code.length < 6) {
      setError('Enter the complete 6-character room code.')
      return
    }

    setError('')
    setIsJoining(true)

    try {
      const result = await joinRoom(code, getParticipantToken(code))
      saveParticipantToken(result.room.code, result.participantToken)
      navigate(`/room/${result.room.code}`)
    } catch (requestError) {
      setError(requestError.message || 'Couldn’t join the room. Please try again.')
      setIsJoining(false)
    }
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
          <button className="button button-primary button-full flow-action-button" type="submit" disabled={isJoining} aria-busy={isJoining}>
            {isJoining ? 'Joining…' : 'Join Room'} <ArrowRightIcon />
          </button>
        </form>

        <p className="prototype-note"><InfoIcon /> Room state is shared securely across devices.</p>
      </div>
    </div>
  )
}
