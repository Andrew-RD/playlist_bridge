import { useState } from 'react'
import { CheckIcon, CopyIcon } from './Icons.jsx'

export function CopyButton({
  value,
  compact = false,
  label = 'Copy Room Code',
  ariaLabel = 'Copy room code',
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  if (compact) {
    return (
      <button className="icon-button" type="button" onClick={handleCopy} aria-label={copied ? 'Copied' : ariaLabel} title={copied ? 'Copied' : ariaLabel}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    )
  }

  return (
    <button className="button button-secondary" type="button" onClick={handleCopy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? 'Copied' : label}
    </button>
  )
}
