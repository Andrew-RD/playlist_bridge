import { Link } from 'react-router-dom'
import { BrandMark } from '../components/BrandMark.jsx'
import { ArrowRightIcon, MusicIcon, PlusIcon, SpotifyIcon } from '../components/Icons.jsx'

const steps = [
  ['Create your room', 'Start a private space or join with a six-character code.'],
  ['Connect both sides', 'One person brings Spotify, the other brings Apple Music.'],
  ['Keep it in sync', 'Your paired playlists will stay together across platforms.'],
]

export function HomePage() {
  return (
    <div className="page home-page">
      <section className="hero-grid">
        <div>
          <p className="eyebrow">Two people. One playlist.</p>
          <h1 className="hero-title">
            Music tastes,<br />
            <span className="gradient-text">perfectly bridged.</span>
          </h1>
          <p className="hero-copy">
            Sync one Spotify playlist with one Apple Music playlist. A simple,
            private room built for <strong>exactly two people.</strong>
          </p>
          <div className="button-row">
            <Link className="button button-primary" to="/create">
              <PlusIcon /> Create Room
            </Link>
            <Link className="button button-secondary" to="/join">
              Join Room <ArrowRightIcon />
            </Link>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="hero-orbit" />
          <div className="platform-node spotify-node"><SpotifyIcon /></div>
          <div className="bridge-center"><BrandMark /></div>
          <div className="platform-node apple-node"><MusicIcon /></div>
          <span className="visual-chip">Ready to sync</span>
        </div>
      </section>

      <section className="how-it-works" aria-labelledby="how-it-works-title">
        <h2 className="section-label" id="how-it-works-title">How it works</h2>
        <div className="steps-grid">
          {steps.map(([title, description], index) => (
            <article className="step-card" key={title}>
              <span className="step-number">0{index + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
