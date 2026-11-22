# Dumbbell Buddhi - React + Python MediaPipe Pushup Coach

AI-powered Pushup Form Tracker and Rep Counter using Google MediaPipe Pose Detection, OpenCV, Python Flask backend, and a modern React frontend styled with plain CSS.

## Architecture

- **`Model.py`**: Contains the core pushup posture logic (joint angles calculation, body flatness check, repetition counter, state machine, and MediaPipe pose landmarker). Can still be run standalone (`python Model.py`) or as a modular engine (`PushupTracker`).
- **`server.py`**: Lightweight Flask backend on port 5001 exposing:
  - `POST /api/start`: Starts the webcam and begins real-time pose tracking.
  - `POST /api/stop`: Stops the webcam and releases hardware resources.
  - `POST /api/reset`: Resets good and bad rep counters.
  - `GET /api/status`: Real-time telemetry (angles, state, good/bad counts, verdict).
  - `GET /video_feed`: MJPEG live video stream displaying the webcam with skeleton lines, keypoints, and form indicators.
- **React Frontend**: Created directly in the root directory using Vite, React 18, and plain CSS (`src/App.css` and `src/index.css`).
  - Big "Start Model.py" / "Stop Model.py" button
  - Webcam viewport with live HUD overlays (UP/DOWN state, FPS, real-time posture instructions)
  - Good/Bad Reps counters
  - Form verdict card
  - Real-time joint angle gauges (Elbow, Hip, Knee, Flatness)

## How to Run

### 1. Start the Backend Server
```bash
./venv/bin/python server.py
```
*(Runs on http://localhost:5001)*

### 2. Start the React Frontend
```bash
npm run dev
```
*(Opens on http://localhost:3000)*

Open **http://localhost:3000** in your browser and click **Start Model.py**!
