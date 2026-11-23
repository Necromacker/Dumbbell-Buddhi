import React, { useState, useEffect, useRef } from 'react';
import Homepage from './Homepage.jsx';
import './App.css';

export default function App() {
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'play'
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [feedTimestamp, setFeedTimestamp] = useState(Date.now());

  // Match state machine: 'idle' | 'get_ready' | 'in_progress' | 'finished'
  const [matchState, setMatchState] = useState('idle');
  const [prepTimer, setPrepTimer] = useState(10);
  const [battleTimer, setBattleTimer] = useState(30);

  const [stats, setStats] = useState({
    good: 0,
    bad: 0,
    fps: 0,
    verdict: '',
    verdict_ok: true,
  });

  const eventSourceRef = useRef(null);
  const timerIntervalRef = useRef(null);

  // SSE Stream to receive real-time pushup stats from Model.py
  useEffect(() => {
    if (isRunning && currentView === 'play') {
      const es = new EventSource('/api/stream_stats');
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setStats({
            good: data.good || 0,
            bad: data.bad || 0,
            fps: Math.round(data.fps || 0),
            verdict: data.verdict || '',
            verdict_ok: data.verdict_ok !== false,
          });
        } catch (e) {
          // ignore
        }
      };

      es.onerror = () => {
        es.close();
      };

      return () => {
        es.close();
      };
    } else {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }
  }, [isRunning, currentView]);

  // Clean up any running countdown timers on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  // Handle Find Match -> 10s Prep -> 30s Match
  const handleFindMatch = async () => {
    setLoading(true);
    setError(null);

    // 1. Start the camera and reset AI counts
    try {
      const res = await fetch('/api/start', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || 'Failed to start webcam');
        setLoading(false);
        return;
      }
      setIsRunning(true);
      setFeedTimestamp(Date.now());
      await fetch('/api/reset', { method: 'POST' });
    } catch (err) {
      setError('Cannot connect to backend server. Make sure server.py is running on port 5001.');
      setLoading(false);
      return;
    }

    setLoading(false);
    setStats({ good: 0, bad: 0, fps: 0, verdict: '', verdict_ok: true });

    // 2. Start 10-second preparation countdown
    setMatchState('get_ready');
    setPrepTimer(10);

    let currentPrep = 10;
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);

    timerIntervalRef.current = setInterval(async () => {
      currentPrep -= 1;
      setPrepTimer(currentPrep);

      if (currentPrep <= 0) {
        clearInterval(timerIntervalRef.current);

        // 3. Reset reps right when the 30-second match starts
        try {
          await fetch('/api/reset', { method: 'POST' });
          setStats({ good: 0, bad: 0, fps: 0, verdict: '', verdict_ok: true });
        } catch (e) {}

        // 4. Start 30-second live match timer
        setMatchState('in_progress');
        setBattleTimer(30);

        let currentBattle = 30;
        timerIntervalRef.current = setInterval(() => {
          currentBattle -= 1;
          setBattleTimer(currentBattle);

          if (currentBattle <= 0) {
            clearInterval(timerIntervalRef.current);
            setMatchState('finished');
          }
        }, 1000);
      }
    }, 1000);
  };

  const handleStopMatch = async () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    try {
      await fetch('/api/stop', { method: 'POST' });
    } catch (e) {}
    setIsRunning(false);
    setMatchState('idle');
  };

  const handleBackToHome = () => {
    handleStopMatch();
    setCurrentView('home');
  };

  // If on homepage, render the Homepage
  if (currentView === 'home') {
    return <Homepage onNavigate={setCurrentView} />;
  }

  // Arena & Webcam Page
  return (
    <div className="arena-page">
      {/* Top Header matching Homepage UI */}
      <header className="arena-header">
        <button className="arena-logo-btn" onClick={handleBackToHome} title="Back to Home">
          <svg className="arena-logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 5v14M18 5v14M2 9v6M22 9v6M6 12h12" />
          </svg>
        </button>

        <h2 className="arena-title">LIVE 1V1 PUSHUP ARENA</h2>

        <button className="arena-back-btn" onClick={handleBackToHome}>
          Back to Home
        </button>
      </header>

      {error && <div className="arena-error-banner">{error}</div>}

      {/* Main 90% Screen Webcam Viewport */}
      <main className="arena-webcam-container">
        <div className="arena-webcam-box">
          {isRunning ? (
            <img
              className="arena-webcam-feed"
              src={`/video_feed?t=${feedTimestamp}`}
              alt="Webcam Feed"
            />
          ) : (
            <div className="arena-webcam-standby">
              <div className="standby-icon-circle">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                  <circle cx="12" cy="13" r="4"></circle>
                </svg>
              </div>
            </div>
          )}

          {/* OVERLAY 1: "Find Match" in the middle when idle */}
          {matchState === 'idle' && (
            <div className="overlay-center">
              <button
                className="btn-find-match"
                onClick={handleFindMatch}
                disabled={loading}
              >
                <span>{loading ? 'STARTING...' : 'FIND MATCH'}</span>
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
              </button>
            </div>
          )}

          {/* OVERLAY 2: 10-Second Prep Counter ("Get in Position") */}
          {matchState === 'get_ready' && (
            <div className="overlay-center prep-overlay">
              <span className="prep-label">GET INTO PUSHUP POSITION</span>
              <div className="prep-number">{prepTimer}</div>
              <span className="prep-subtext">Match begins when timer hits 0</span>
            </div>
          )}

          {/* OVERLAY 3: 30-Second Live Match Header */}
          {matchState === 'in_progress' && (
            <div className="live-battle-hud">
              <div className="live-pulse-badge">
                <span className="live-dot"></span> LIVE MATCH
              </div>
              <div className="live-timer-badge">
                TIME LEFT: <strong>{battleTimer}s</strong>
              </div>
            </div>
          )}

          {/* OVERLAY 4: Match Finished */}
          {matchState === 'finished' && (
            <div className="overlay-center finished-overlay">
              <span className="finished-title">TIME'S UP! MATCH COMPLETED</span>
              <div className="finished-score">
                <span>FINAL GOOD REPS</span>
                <strong>{stats.good}</strong>
              </div>
              <div className="finished-buttons">
                <button className="btn-find-match" onClick={handleFindMatch}>
                  PLAY AGAIN
                </button>
                <button className="btn-secondary" onClick={handleBackToHome}>
                  HOME
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Displayed ONLY just below the webcam box: Good Reps and Verdict */}
        <div className="arena-stats-row">
          {/* 1. Good Reps Card */}
          <div className="stat-card good-reps-card">
            <span className="stat-title">GOOD REPS</span>
            <span className="stat-value">{stats.good}</span>
          </div>

          {/* 2. Verdict Card Beside It */}
          <div className="stat-card verdict-card">
            <span className="stat-title">FORM VERDICT</span>
            {stats.verdict ? (
              <div className={`verdict-badge ${stats.verdict_ok ? 'verdict-ok' : 'verdict-bad'}`}>
                {stats.verdict}
              </div>
            ) : (
              <div className="verdict-badge verdict-empty">
                {matchState === 'in_progress' ? 'Start doing pushups...' : 'Awaiting match start'}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
