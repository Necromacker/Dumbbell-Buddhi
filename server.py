import json
import logging
import os
import threading
import time
import uuid
from typing import Any, Optional
import cv2
from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
from Model import PushupTracker, CAM_INDEX, FRAME_W, FRAME_H, TARGET_FPS

# Suppress repetitive HTTP polling logs from Werkzeug
logging.getLogger('werkzeug').setLevel(logging.ERROR)

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# Real Matchmaking Queue & Active 1v1 Rooms
waiting_queue: list[str] = []
active_rooms: dict[str, dict[str, Any]] = {}

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "waiting_players": len(waiting_queue), "active_rooms": len(active_rooms)})

@socketio.on("connect")
def on_connect():
    pass

@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    if sid in waiting_queue:
        waiting_queue.remove(sid)

    # Clean up any active battle rooms
    for room_id, room_data in list(active_rooms.items()):
        if sid in room_data.get("players", []):
            emit("opponent_left", {"message": "Opponent disconnected"}, to=room_id)
            del active_rooms[room_id]
            break

@socketio.on("find_match")
def on_find_match(data=None):
    sid = request.sid
    if sid in waiting_queue:
        return

    if waiting_queue:
        # Match with the waiting real player
        opponent_sid = waiting_queue.pop(0)
        room_id = f"battle_{uuid.uuid4().hex[:8]}"

        join_room(room_id, sid=sid)
        join_room(room_id, sid=opponent_sid)

        active_rooms[room_id] = {
            "players": [opponent_sid, sid]
        }

        # Tell both real players match is found
        emit("match_found", {
            "room_id": room_id,
            "is_initiator": True,
            "opponent_id": sid
        }, to=opponent_sid)

        emit("match_found", {
            "room_id": room_id,
            "is_initiator": False,
            "opponent_id": opponent_sid
        }, to=sid)
    else:
        waiting_queue.append(sid)
        emit("queued", {"status": "waiting"})

@socketio.on("cancel_match")
def on_cancel_match():
    sid = request.sid
    if sid in waiting_queue:
        waiting_queue.remove(sid)
    emit("cancelled", {"status": "idle"})

@socketio.on("webrtc_signal")
def on_webrtc_signal(data):
    room_id = data.get("room_id")
    if room_id:
        emit("webrtc_signal", data, to=room_id, include_self=False)

@socketio.on("rep_update")
def on_rep_update(data):
    room_id = data.get("room_id")
    if room_id:
        emit("rep_update", data, to=room_id, include_self=False)

class VideoStreamManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.is_running: bool = False
        self.thread: Optional[threading.Thread] = None
        self.cap: Optional[cv2.VideoCapture] = None
        self.latest_jpeg: Optional[bytes] = None
        
        # Initialize tracker instance
        self.tracker: PushupTracker = PushupTracker()

        self.latest_stats: dict[str, Any] = {
            "state": "UP",
            "in_rep": False,
            "good": 0,
            "bad": 0,
            "verdict": "",
            "verdict_ok": True,
            "status": "Ready. Click Start to begin.",
            "elbow": None,
            "hip_ang": None,
            "knee_ang": None,
            "flat_deg": None,
            "straight": True,
            "valid": False,
            "fps": 0.0,
            "is_running": False
        }

    def start(self):
        with self.lock:
            if self.is_running:
                return True, "Model is already running."

            self.cap = cv2.VideoCapture(CAM_INDEX)
            if not self.cap.isOpened():
                return False, "Could not open webcam. Please verify camera permissions or CAM_INDEX."

            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_W)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_H)
            self.cap.set(cv2.CAP_PROP_FPS, TARGET_FPS)
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            self.is_running = True
            self.thread = threading.Thread(target=self._capture_loop, daemon=True)
            self.thread.start()
            return True, "Model started successfully."

    def stop(self):
        with self.lock:
            if not self.is_running:
                return True, "Model is already stopped."
            self.is_running = False

        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=1.5)

        with self.lock:
            if self.cap:
                self.cap.release()
                self.cap = None
            self.latest_stats["is_running"] = False
            self.latest_stats["status"] = "Model stopped."
            self.latest_jpeg = None
            return True, "Model stopped successfully."

    def reset(self):
        with self.lock:
            self.tracker.reset()
            self.latest_stats["good"] = 0
            self.latest_stats["bad"] = 0
            self.latest_stats["verdict"] = ""
            self.latest_stats["state"] = "UP"
            return True, "Counters reset."

    def _capture_loop(self):
        while self.is_running and self.cap and self.cap.isOpened():
            ok, frame = self.cap.read()
            if not ok or frame is None:
                time.sleep(0.01)
                continue

            # Local variable assignment for strict type narrowing
            tracker: PushupTracker = self.tracker
            if tracker is None:
                continue

            try:
                processed_frame, stats = tracker.process_frame(frame, draw_overlay=True)
                stats["is_running"] = True

                # Encode as JPEG
                ret, buffer = cv2.imencode('.jpg', processed_frame, [(cv2.IMWRITE_JPEG_QUALITY), 50])
                if ret:
                    with self.lock:
                        self.latest_jpeg = buffer.tobytes()
                        self.latest_stats = stats
            except Exception as e:
                print(f"Error processing frame: {e}")

            time.sleep(0.005)

        # Cleanup if loop exits
        with self.lock:
            if self.cap:
                self.cap.release()
                self.cap = None

    def get_stats(self):
        with self.lock:
            stats = dict(self.latest_stats)
            stats["is_running"] = self.is_running
            return stats

    def generate_mjpeg(self):
        while True:
            with self.lock:
                frame_data = self.latest_jpeg
                running = self.is_running

            if not running:
                break

            if frame_data is not None:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame_data + b'\r\n')
            time.sleep(0.02)


stream_mgr = VideoStreamManager()


@app.route("/api/start", methods=["POST"])
def api_start():
    success, msg = stream_mgr.start()
    return jsonify({"success": success, "message": msg, "is_running": stream_mgr.is_running}), (200 if success else 500)


@app.route("/api/stop", methods=["POST"])
def api_stop():
    success, msg = stream_mgr.stop()
    return jsonify({"success": success, "message": msg, "is_running": stream_mgr.is_running})


@app.route("/api/reset", methods=["POST"])
def api_reset():
    success, msg = stream_mgr.reset()
    return jsonify({"success": success, "message": msg})


@app.route("/api/status", methods=["GET"])
def api_status():
    return jsonify(stream_mgr.get_stats())


@app.route("/api/stream_stats")
def stream_stats():
    def event_stream():
        while stream_mgr.is_running:
            with stream_mgr.lock:
                stats = dict(stream_mgr.latest_stats)
            yield f"data: {json.dumps(stats)}\n\n"
            time.sleep(0.1)

    return Response(event_stream(), mimetype="text/event-stream")


@app.route("/video_feed")
def video_feed():
    if not stream_mgr.is_running:
        return "Camera is not active. Click 'Start Model' to begin.", 404
    return Response(stream_mgr.generate_mjpeg(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print(f"Starting Dumbbell Buddhi Server on port {port}")
    socketio.run(app, host="0.0.0.0", port=port, debug=False)
