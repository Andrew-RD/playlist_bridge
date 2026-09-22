import { CopyButton } from './CopyButton.jsx'

export function RoomCodeCard({ code }) {
  return (
    <div className="room-code-box">
      <div>
        <span className="room-code-label">Room code</span>
        <strong className="room-code">{code}</strong>
      </div>
      <CopyButton value={code} compact />
    </div>
  )
}
