import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import { io } from 'socket.io-client';
import { BrowserPushupTracker } from './poseTracker.js';
import Homepage from './Homepage.jsx';
import './App.css';

export default function App() {
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'play'
  const [loading, setLoading] = useState(false);

  // Match state machine: 'idle' | 'searching' | 'matched' | 'get_ready' | 'in_progress' | 'finished'
  const [matchState, setMatchState] = useState('idle');
  const [prepTimer, setPrepTimer] = useState(10);
  const [battleTimer, setBattleTimer] = useState(30);

  // User and Opponent scores (strictly numbers)
  const [userReps, setUserReps] = useState(0);
  const [opponentReps, setOpponentReps] = useState(0);

  // Video streams
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  // References
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const searchIntervalRef = useRef(null);
  const broadcastChannelRef = useRef(null);
  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const peerConnRef = useRef(null);
  const currentRoomRef = useRef(null);
  const myClientIdRef = useRef('player_' + Math.random().toString(36).substring(2, 9));
  const isHostRef = useRef(false);
  const trackerRef = useRef(null);
  const animFrameRef = useRef(null);

  // Initialize In-Browser MediaPipe Pushup Tracker
  useEffect(() => {
    if (currentView === 'play') {
      const tracker = new BrowserPushupTracker((newReps) => {
        setUserReps(newReps);
      });
      tracker.initialize();
      trackerRef.current = tracker;
    }
    return () => {
      trackerRef.current = null;
    };
  }, [currentView]);

  // Real-Time Pushup Pose Detection Loop during live battle
  useEffect(() => {
    if (matchState === 'in_progress' && trackerRef.current) {
      trackerRef.current.reset();

      let isLoopRunning = true;
      const detectLoop = (now) => {
        if (!isLoopRunning) return;
        if (localVideoRef.current && trackerRef.current) {
          trackerRef.current.processVideoFrame(localVideoRef.current, now);
        }
        animFrameRef.current = requestAnimationFrame(detectLoop);
      };

      animFrameRef.current = requestAnimationFrame(detectLoop);

      return () => {
        isLoopRunning = false;
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
        }
      };
    }
  }, [matchState]);

  // Initialize Local Camera stream when entering 'play' view
  useEffect(() => {
    let activeStream = null;

    if (currentView === 'play') {
      navigator.mediaDevices?.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      })
        .then((stream) => {
          activeStream = stream;
          setLocalStream(stream);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }
        })
        .catch(() => {
          // Camera not permitted or not available
        });
    }

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [currentView]);

  // Ensure video element gets srcObject when localStream changes
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, currentView]);

  // Ensure remote video element gets remoteStream
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, matchState]);

  // Socket.IO (for internet matchmaking on Render / Netlify) + BroadcastChannel (for local tabs)
  useEffect(() => {
    if (currentView !== 'play') return;

    // 1. Socket.IO connection to backend (Render or localhost)
    const backendUrl = import.meta.env.VITE_BACKEND_URL || (window.location.hostname === 'localhost' ? 'http://localhost:5001' : window.location.origin);
    const socket = io(backendUrl, {
      autoConnect: true,
      transports: ['websocket', 'polling']
    });
    socketRef.current = socket;

    socket.on('match_found', (data) => {
      currentRoomRef.current = data.room_id;
      if (data.is_initiator) {
        isHostRef.current = true;
        if (peerRef.current && localStream) {
          try {
            const call = peerRef.current.call(data.opponent_id, localStream);
            if (call) {
              call.on('stream', (incomingStream) => {
                setRemoteStream(incomingStream);
              });
            }
          } catch (e) {}
        }
      } else {
        isHostRef.current = false;
      }
      beginMatchedCountdown();
    });

    socket.on('rep_update', (data) => {
      if (typeof data?.reps === 'number') {
        setOpponentReps(data.reps);
      }
    });

    socket.on('opponent_left', () => {
      setMatchState('idle');
      setRemoteStream(null);
    });

    // 2. BroadcastChannel for instant local 1v1 tab matchmaking
    const channel = new BroadcastChannel('dumbbell_matchmaking_1v1');
    broadcastChannelRef.current = channel;

    channel.onmessage = (event) => {
      const data = event.data;
      if (!data || data.senderId === myClientIdRef.current) return;

      if (data.type === 'SEARCHING' && matchState === 'searching') {
        // Tie-breaker: decide who initiates the WebRTC call
        if (myClientIdRef.current > data.senderId) {
          isHostRef.current = true;
          channel.postMessage({
            type: 'MATCH_ACCEPT',
            senderId: myClientIdRef.current,
            targetId: data.senderId,
            hostId: myClientIdRef.current
          });

          // Call opponent's peer directly
          if (peerRef.current && localStream) {
            try {
              const call = peerRef.current.call(data.senderId, localStream);
              if (call) {
                call.on('stream', (incomingStream) => {
                  setRemoteStream(incomingStream);
                });
              }
            } catch (err) {}
          }

          beginMatchedCountdown();
        }
      } else if (data.type === 'MATCH_ACCEPT' && data.targetId === myClientIdRef.current && matchState === 'searching') {
        isHostRef.current = false;
        beginMatchedCountdown();
      } else if (data.type === 'REP_UPDATE' && (matchState === 'in_progress' || matchState === 'get_ready')) {
        setOpponentReps(data.reps);
      } else if (data.type === 'MATCH_FINISH') {
        setMatchState('finished');
      }
    };

    // 3. PeerJS for WebRTC Video Call
    try {
      const peer = new Peer(myClientIdRef.current);
      peerRef.current = peer;

      peer.on('call', (call) => {
        if (localStream) {
          call.answer(localStream);
        } else {
          call.answer();
        }
        call.on('stream', (incomingStream) => {
          setRemoteStream(incomingStream);
        });
      });

      peer.on('connection', (conn) => {
        peerConnRef.current = conn;
        conn.on('data', (data) => {
          if (data?.type === 'REP_UPDATE') {
            setOpponentReps(data.reps);
          }
        });
      });
    } catch (e) {}

    return () => {
      channel.close();
      socket.disconnect();
      if (peerRef.current) {
        peerRef.current.destroy();
      }
    };
  }, [currentView, matchState, localStream]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (searchIntervalRef.current) clearInterval(searchIntervalRef.current);
    };
  }, []);

  // Broadcast user rep updates to real opponent whenever userReps changes
  useEffect(() => {
    if (matchState === 'in_progress') {
      // Send to Socket.IO room (Render / Netlify)
      if (socketRef.current && currentRoomRef.current) {
        socketRef.current.emit('rep_update', {
          room_id: currentRoomRef.current,
          reps: userReps
        });
      }
      // Send to local BroadcastChannel
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.postMessage({
          type: 'REP_UPDATE',
          senderId: myClientIdRef.current,
          reps: userReps
        });
      }
      // Send via WebRTC DataChannel
      if (peerConnRef.current) {
        try {
          peerConnRef.current.send({ type: 'REP_UPDATE', reps: userReps });
        } catch (e) {}
      }
    }
  }, [userReps, matchState]);

  // Start Search for REAL Opponent (keeps searching until a real opponent joins)
  const handleStartSearching = () => {
    setMatchState('searching');
    setUserReps(0);
    setOpponentReps(0);
    setRemoteStream(null);

    // 1. Emit to Socket.IO matchmaking queue (Render)
    if (socketRef.current) {
      socketRef.current.emit('find_match', { clientId: myClientIdRef.current });
    }

    // 2. Broadcast to local BroadcastChannel
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.postMessage({
        type: 'SEARCHING',
        senderId: myClientIdRef.current
      });
    }

    // Ping every 1 second locally so any new real opponent tab instantly pairs
    if (searchIntervalRef.current) clearInterval(searchIntervalRef.current);
    searchIntervalRef.current = setInterval(() => {
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.postMessage({
          type: 'SEARCHING',
          senderId: myClientIdRef.current
        });
      }
    }, 1000);
  };

  // Once REAL opponent is found, initiate synchronized countdown & battle
  const beginMatchedCountdown = () => {
    if (searchIntervalRef.current) clearInterval(searchIntervalRef.current);

    setMatchState('matched');

    // 1-second "MATCH FOUND!" announcement, then 10s prep
    setTimeout(() => {
      setMatchState('get_ready');
      setPrepTimer(10);

      let currentPrep = 10;
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);

      timerIntervalRef.current = setInterval(() => {
        currentPrep -= 1;
        setPrepTimer(currentPrep);

        if (currentPrep <= 0) {
          clearInterval(timerIntervalRef.current);

          // Begin 30s battle
          setMatchState('in_progress');
          setBattleTimer(30);
          setUserReps(0);
          setOpponentReps(0);

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
    }, 1200);
  };

  const handleStopMatch = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (searchIntervalRef.current) clearInterval(searchIntervalRef.current);
    if (socketRef.current) {
      socketRef.current.emit('cancel_match');
    }
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
        {localStream ? (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="fullscreen-feed"
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
            <span className="live-counter-num green-num">{userReps}</span>
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
              onClick={handleStartSearching}
              disabled={loading}
              title="Play"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="8 5 19 12 8 19 8 5"></polygon>
              </svg>
            </button>
          </div>
        )}

        {/* MATCHMAKING: Looking for Opponent */}
        {matchState === 'searching' && (
          <div className="overlay-center matchmaking-overlay">
            <div className="radar-circle-pulse">
              <div className="radar-inner-dot" />
            </div>
            <div className="matchmaking-title">LOOKING FOR OPPONENT...</div>
            <button className="btn-cancel-search" onClick={handleStopMatch}>
              CANCEL
            </button>
          </div>
        )}

        {/* OPPONENT FOUND BRIEF POPUP */}
        {matchState === 'matched' && (
          <div className="overlay-center matched-announcement">
            <div className="matched-badge">OPPONENT FOUND!</div>
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

        {/* FLOATING WINDOW AT BOTTOM RIGHT: Clean Opponent Webcam Video (No name, No counter overlay) */}
        {(matchState === 'matched' || matchState === 'get_ready' || matchState === 'in_progress' || matchState === 'finished') && (
          <div className="opponent-floating-window">
            <div className="floating-video-viewport">
              {remoteStream ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="floating-video-feed"
                />
              ) : (
                <div className="floating-placeholder-view">
                  <div className="floating-avatar-box">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                    </svg>
                  </div>
                  <span className="floating-connecting-txt">OPPONENT CAM</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
