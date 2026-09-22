import { Link } from 'react-router-dom'
import { ArrowLeftIcon } from './Icons.jsx'

export function BackLink({ to = '/', children = 'Back home' }) {
  return <Link className="back-link" to={to}><ArrowLeftIcon />{children}</Link>
}
