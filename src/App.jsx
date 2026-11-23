import React, { useState, useEffect, useRef } from 'react';
import Homepage from './Homepage.jsx';
import './App.css';

export default function App() {
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'play'
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedTimestamp, setFeedTimestamp] = useState(Date.now());

  // Match state machine: 'idle' | 'get_ready' | 'in_progress' | 'finished'
  const [matchState, setMatchState] = useState('idle');
  const [prepTimer, setPrepTimer] = useState(10);
  const [battleTimer, setBattleTimer] = useState(30);

  // User and Opponent scores (strictly numbers)
  const [userReps, setUserReps] = useState(0);
  const [opponentReps, setOpponentReps] = useState(0);

  const eventSourceRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const opponentIntervalRef = useRef(null);

  // SSE Stream to receive real-time pushup stats from Model.py if backend is running
  useEffect(() => {
    if (isRunning && currentView === 'play') {
      const es = new EventSource('/api/stream_stats');
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (typeof data.good === 'number') {
            setUserReps(data.good);
          }
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
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (opponentIntervalRef.current) clearInterval(opponentIntervalRef.current);
    };
  }, []);

  // Handle Play -> Only 10s Timer -> 30s Match
  const handleStartMatch = async () => {
    setLoading(true);

    try {
      const res = await fetch('/api/start', { method: 'POST' });
      const data = await res.json();
      if (data && data.success) {
        setIsRunning(true);
        setFeedTimestamp(Date.now());
        await fetch('/api/reset', { method: 'POST' });
      }
    } catch (err) {
      // Backend not running - silently continue
    }

    setLoading(false);
    setUserReps(0);
    setOpponentReps(0);

    // 1. 10-second preparation countdown (ONLY the number)
    setMatchState('get_ready');
    setPrepTimer(10);

    let currentPrep = 10;
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (opponentIntervalRef.current) clearInterval(opponentIntervalRef.current);

    timerIntervalRef.current = setInterval(async () => {
      currentPrep -= 1;
      setPrepTimer(currentPrep);

      if (currentPrep <= 0) {
        clearInterval(timerIntervalRef.current);

        // Reset reps when live battle begins
        try {
          await fetch('/api/reset', { method: 'POST' });
        } catch (e) {}
        setUserReps(0);
        setOpponentReps(0);

        // 2. 30-second live battle timer
        setMatchState('in_progress');
        setBattleTimer(30);

        // Opponent live pace simulator
        opponentIntervalRef.current = setInterval(() => {
          setOpponentReps((prev) => prev + 1);
        }, 2600);

        let currentBattle = 30;
        timerIntervalRef.current = setInterval(() => {
          currentBattle -= 1;
          setBattleTimer(currentBattle);

          if (currentBattle <= 0) {
            clearInterval(timerIntervalRef.current);
            if (opponentIntervalRef.current) clearInterval(opponentIntervalRef.current);
            setMatchState('finished');
          }
        }, 1000);
      }
    }, 1000);
  };

  const handleStopMatch = async () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (opponentIntervalRef.current) clearInterval(opponentIntervalRef.current);
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

  // If on homepage, render Homepage
  if (currentView === 'home') {
    return <Homepage onNavigate={setCurrentView} />;
  }

  // Calculate live tug-of-war battle line percentage
  const totalReps = userReps + opponentReps;
  const userPercent = totalReps === 0 ? 50 : Math.max(10, Math.min(90, (userReps / totalReps) * 100));
  const oppPercent = 100 - userPercent;

  return (
    <div className="fullscreen-arena">
      {/* 100% Height & Width Fullscreen Webcam Viewport */}
      <div className="arena-fullscreen-viewport">
        {isRunning ? (
          <img
            className="fullscreen-feed"
            src={`/video_feed?t=${feedTimestamp}`}
            alt="Webcam Feed"
          />
        ) : (
          <div className="fullscreen-standby">
            <div className="standby-icon-circle">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
              </svg>
            </div>
          </div>
        )}

        {/* TOP BAR: [ X ] on Left <---> [ Counter in Middle ] <---> [ 30s Timer on Right ] */}
        <header className="arena-top-header">
          {/* Left: Clean X button */}
          <button className="top-x-btn" onClick={handleBackToHome} title="Exit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          {/* Middle: Live counter with numbers at both ends and line in middle */}
          <div className="top-battle-line-group">
            {/* Left: Green User Number only */}
            <span className="live-counter-num green-num">{userReps}</span>

            {/* Middle: Live changing split line */}
            <div className="live-battle-bar">
              <div
                className="live-segment user-segment"
                style={{ width: `${userPercent}%` }}
              />
              <div
                className="live-segment opp-segment"
                style={{ width: `${oppPercent}%` }}
              />
            </div>

            {/* Right: Red Opponent Number only */}
            <span className="live-counter-num red-num">{opponentReps}</span>
          </div>

          {/* Right: 30s Timer badge just like the X button */}
          <div className="top-timer-btn" title="Timer">
            <span>{battleTimer}</span>
          </div>
        </header>

        {/* CENTER OVERLAY: Play Button in the middle when idle */}
        {matchState === 'idle' && (
          <div className="overlay-center">
            <button
              className="btn-circle-play"
              onClick={handleStartMatch}
              disabled={loading}
              title="Play"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="8 5 19 12 8 19 8 5"></polygon>
              </svg>
            </button>
          </div>
        )}

        {/* 10-Second Prep Counter: ONLY THE NUMBER */}
        {matchState === 'get_ready' && (
          <div className="overlay-center">
            <div className="raw-timer-number">{prepTimer}</div>
          </div>
        )}

        {/* Match Finished / Result: RETURN button without any SVG */}
        {matchState === 'finished' && (
          <div className="overlay-center finished-overlay">
            <div className="finished-scores">
              <span className="green-num">{userReps}</span>
              <span className="score-sep">-</span>
              <span className="red-num">{opponentReps}</span>
            </div>
            <button className="btn-return" onClick={handleBackToHome} title="Return">
              RETURN
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
