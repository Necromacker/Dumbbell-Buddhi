import React from 'react';
import img1 from './Imgs/Img 1.png';
import './Homepage.css';

export default function Homepage({ onNavigate }) {
  return (
    <div className="home-wrapper">
      {/* Hero Headline Section - Centered in 100vh */}
      <main className="hero-section">
        <h1 className="hero-headline">
          {/* Line 1: CHASE [Sunburst Badge with Img 1.png] YOUR */}
          <div className="hero-line">
            <span>CHASE</span>
            <div className="badge-inline badge-sunburst">
              <img
                className="badge-sunburst-img"
                src={img1}
                alt="Sunburst Badge"
              />
            </div>
            <span>YOUR</span>
          </div>

          {/* Line 2: DREAM WITH [Pill Photo Badge] */}
          <div className="hero-line">
            <span>DREAM WITH</span>
            <div className="badge-inline badge-pill-photo">
              <img
                className="pill-photo-img"
                src="https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=500&auto=format&fit=crop&q=80"
                alt="Pushup athletes"
              />
            </div>
          </div>

          {/* Line 3: ALL [Lime Circle Badge] YOUR MIGHT */}
          <div className="hero-line">
            <span>ALL</span>
            <div className="badge-inline badge-lime-circle">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <span>YOUR MIGHT</span>
          </div>
        </h1>
      </main>

      {/* Center Notch Divider from Reference Image */}
      <div className="notch-indicator"></div>

      {/* Bottom 3 Floating Cards (Orange, Lavender, Lime) */}
      <footer className="cards-container">
        {/* Card 1: Warm Orange - Pushup Challenge */}
        <div className="mode-card card-orange" onClick={() => onNavigate('play')}>
          <span className="card-top-tag">LIVE CHALLENGE</span>
          <div className="card-bottom-row">
            <div className="card-title-group">
              <div className="card-icon-box">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 5v14M18 5v14M2 9v6M22 9v6M6 12h12" />
                </svg>
              </div>
              <span className="card-title-text">PUSHUP CHALLENGE</span>
            </div>
            <div className="card-play-btn">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            </div>
          </div>
        </div>

        {/* Card 2: Soft Lavender - Squat Challenge */}
        <div className="mode-card card-lavender" onClick={() => onNavigate('play')}>
          <span className="card-top-tag">NEW CHALLENGE</span>
          <div className="card-bottom-row">
            <div className="card-title-group">
              <div className="card-icon-box">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 18l4-8 4 4 4-8 4 12" />
                </svg>
              </div>
              <span className="card-title-text">SQUAT CHALLENGE</span>
            </div>
            <div className="card-play-btn">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            </div>
          </div>
        </div>

        {/* Card 3: Neon Lime - Coming Soon */}
        <div className="mode-card card-lime">
          <span className="card-top-tag">MORE MODES</span>
          <div className="card-bottom-row">
            <div className="card-title-group">
              <div className="card-icon-box">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <span className="card-title-text">COMING SOON</span>
            </div>
            <div className="card-play-btn">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
