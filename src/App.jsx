import React, { useState, useEffect, useRef } from 'react';
import './App.css';

export default function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [feedTimestamp, setFeedTimestamp] = useState(Date.now());
  
  const [stats, setStats] = useState({
    good: 0,
    verdict: '',
    verdict_ok: true,
    is_running: false,
  });

  const pollIntervalRef = useRef(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        if (typeof data.is_running === 'boolean') {
          setIsRunning(data.is_running);
        }
      }
    } catch (err) {
      // Backend not yet reachable
    }
  };

  useEffect(() => {
    fetchStatus();
    pollIntervalRef.current = setInterval(fetchStatus, 200);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const handleStart = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/start', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setIsRunning(true);
        setFeedTimestamp(Date.now());
      } else {
        setError(data.message || 'Failed to start webcam');
      }
    } catch (err) {
      setError('Cannot connect to backend server. Make sure server.py is running on port 5001.');
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/stop', { method: 'POST' });
      const data = await res.json();
      setIsRunning(false);
    } catch (err) {
      setError('Error while stopping model: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    try {
      await fetch('/api/reset', { method: 'POST' });
      setStats((prev) => ({
        ...prev,
        good: 0,
        verdict: '',
      }));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="app-container">
      {/* Control Buttons: Start, Stop, Reset */}
      <div className="controls-row">
        <button
          className="btn btn-start"
          onClick={handleStart}
          disabled={loading || isRunning}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          Start
        </button>

        <button
          className="btn btn-stop"
          onClick={handleStop}
          disabled={loading || !isRunning}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="5" width="14" height="14" rx="2"></rect>
          </svg>
          Stop
        </button>

        <button
          className="btn btn-reset"
          onClick={handleReset}
          disabled={loading}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          Reset
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Webcam View */}
      <div className="webcam-box">
        {isRunning ? (
          <img
            className="webcam-feed"
            src={`/video_feed?t=${feedTimestamp}`}
            alt="Webcam Feed"
          />
        ) : (
          <div className="webcam-offline">
            <div className="camera-circle">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
              </svg>
            </div>
            <p>Webcam is off. Click <strong>Start</strong> to begin.</p>
          </div>
        )}
      </div>

      {/* Stats Row: Good Reps & Latest Form Verdict */}
      <div className="stats-row">
        {/* Good Reps */}
        <div className="stat-card good-reps-card">
          <span className="stat-title">Good Reps</span>
          <span className="stat-count">{stats.good}</span>
        </div>

        {/* Latest Form Verdict */}
        <div className="stat-card verdict-card">
          <span className="stat-title">Latest Form Verdict</span>
          {stats.verdict ? (
            <div className={`verdict-text ${stats.verdict_ok ? 'verdict-ok' : 'verdict-bad'}`}>
              {stats.verdict}
            </div>
          ) : (
            <div className="verdict-text verdict-empty">No reps yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
