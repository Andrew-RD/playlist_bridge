import { Link, Outlet, useMatch } from 'react-router-dom'
import { BrandMark } from './BrandMark.jsx'

export function AppLayout() {
  const isRoomRoute = Boolean(useMatch('/room/:code'))
  const brandContent = (
    <>
      <BrandMark />
      <span>Playlist Bridge</span>
    </>
  )

  return (
    <div className="app-shell">
      <header className="site-header">
        {isRoomRoute ? (
          <span className="brand">{brandContent}</span>
        ) : (
          <Link className="brand" to="/" aria-label="Playlist Bridge home">
            {brandContent}
          </Link>
        )}
        <span className="header-pill">2-person rooms</span>
      </header>

      <main className="page-main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <span>Playlist Bridge — made for two.</span>
        <span className="footer-platforms">Spotify <span>↔</span> Apple Music</span>
      </footer>
    </div>
  )
}
