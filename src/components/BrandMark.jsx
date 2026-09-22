export function BrandMark({ title }) {
  const labelled = Boolean(title)

  return (
    <svg
      className="brand-mark"
      viewBox="0 0 48 48"
      fill="none"
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
      aria-label={labelled ? title : undefined}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="brand-fill" x1="7" y1="5" x2="42" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A56CF3" />
          <stop offset="0.52" stopColor="#E85C9A" />
          <stop offset="1" stopColor="#64E89A" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="14" fill="#1E1422" />
      <rect x="2.5" y="2.5" width="43" height="43" rx="13.5" stroke="white" strokeOpacity=".1" />
      <circle cx="14.5" cy="24" r="5.5" fill="#67E898" />
      <circle cx="33.5" cy="24" r="5.5" fill="#F0649D" />
      <path d="M18.8 19.6C21.7 16.9 26.3 16.9 29.2 19.6" stroke="url(#brand-fill)" strokeWidth="3" strokeLinecap="round" />
      <path d="M18.8 28.4C21.7 31.1 26.3 31.1 29.2 28.4" stroke="url(#brand-fill)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
