const commonProps = {
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

export function ArrowLeftIcon() {
  return <svg {...commonProps}><path d="m15 18-6-6 6-6" /></svg>
}

export function ArrowRightIcon() {
  return <svg {...commonProps}><path d="m9 18 6-6-6-6" /></svg>
}

export function CheckIcon() {
  return <svg {...commonProps}><path d="m5 12 4 4L19 6" /></svg>
}

export function CopyIcon() {
  return <svg {...commonProps}><rect width="12" height="12" x="8" y="8" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
}

export function InfoIcon() {
  return <svg {...commonProps}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
}

export function LinkIcon() {
  return <svg {...commonProps}><path d="M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.14" /><path d="M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.14-1.14" /></svg>
}

export function LeaveIcon() {
  return <svg {...commonProps}><path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M14 8l4 4-4 4M9 12h9" /></svg>
}

export function PlusIcon() {
  return <svg {...commonProps}><path d="M12 5v14M5 12h14" /></svg>
}

export function UserIcon() {
  return <svg {...commonProps}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>
}

export function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" opacity=".16" />
      <path d="M6.8 9.1c3.9-1.2 8.3-.8 11.5 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7.5 12.3c3.2-.9 6.9-.6 9.8.8M8.3 15.2c2.6-.6 5.5-.4 7.8.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function MusicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 17V6.8l9-1.8v9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="6.5" cy="18" rx="2.5" ry="2" fill="currentColor" />
      <ellipse cx="15.5" cy="15.5" rx="2.5" ry="2" fill="currentColor" />
    </svg>
  )
}
