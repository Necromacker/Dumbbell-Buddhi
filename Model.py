import math
import os
import time
from typing import Any
import urllib.request
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

# ======================= SETTINGS =======================
CAM_INDEX = 0
FRAME_W, FRAME_H, TARGET_FPS = 1080, 720, 60

UP_ANGLE = 160        # elbow above this = arms straight (top)
DOWN_ANGLE = 90       # elbow must reach this or lower (bottom)
STRAIGHT_MIN = 160    # shoulder-hip-knee and hip-knee-ankle angles must stay above this
KNEE_LIFT = 0.15      # move the knee point UP by this fraction of the hip-knee length (0 = off, 0.15 = more)
FLAT_MAX_DEG = 35     # shoulder-to-ankle line must be within this angle of the floor (blocks sitting/standing)
BAD_FRAMES = 6        # a bad reading must last this many frames in a row
VIS_MIN = 0.5
ALPHA = 0.5           # smoothing (lower = smoother but laggier)
DEAD_PX = 2.0
# ========================================================

MODEL_FILE = "pose_landmarker_lite.task"
MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
             "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task")

# landmark ids: shoulder, elbow, wrist, hip, knee, ankle
LEFT = dict(s=11, e=13, w=15, h=23, k=25, a=27)
RIGHT = dict(s=12, e=14, w=16, h=24, k=26, a=28)
BONES = [("s", "e"), ("e", "w"), ("s", "h"), ("h", "k"), ("k", "a")]


def angle(a, b, c):
    """Angle at b (degrees) between points a-b-c."""
    v1 = math.atan2(a[1] - b[1], a[0] - b[0])
    v2 = math.atan2(c[1] - b[1], c[0] - b[0])
    d = abs(math.degrees(v1 - v2))
    return 360 - d if d > 180 else d


class PushupTracker:
    def __init__(self, model_file=MODEL_FILE):
        if not os.path.exists(model_file):
            print("Downloading lite model...")
            try:
                urllib.request.urlretrieve(MODEL_URL, model_file)
            except Exception as e:
                print("Download failed:", e, "\nGet it from:", MODEL_URL)
                raise

        self.landmarker = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=model_file),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        ))

        self.prev_pts = {}
        self.state = "UP"              # UP or DOWN
        self.in_rep = False
        self.min_elbow = 180.0
        self.bent_count = 0
        self.bent_flag = False
        self.good = 0
        self.bad = 0
        self.verdict = ""
        self.verdict_ok = True

        self.start_t = time.time()
        self.prev_t = self.start_t
        self.fps = 0.0

    def smooth(self, i, x, y):
        p = self.prev_pts.get(i)
        if p is None:
            self.prev_pts[i] = (x, y)
        elif abs(x - p[0]) >= DEAD_PX or abs(y - p[1]) >= DEAD_PX:
            self.prev_pts[i] = (ALPHA * x + (1 - ALPHA) * p[0], ALPHA * y + (1 - ALPHA) * p[1])
        return self.prev_pts[i]

    def reset(self):
        self.state = "UP"
        self.in_rep = False
        self.min_elbow = 180.0
        self.bent_count = 0
        self.bent_flag = False
        self.good = 0
        self.bad = 0
        self.verdict = ""
        self.verdict_ok = True
        self.prev_pts.clear()

    def process_frame(self, frame, draw_overlay=True):
        """Processes a single raw BGR video frame and updates pushup metrics."""
        frame = cv2.flip(frame, 1)
        h, w = frame.shape[:2]

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = self.landmarker.detect_for_video(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb),
            int((time.time() - self.start_t) * 1000)
        )

        status = "No person detected"
        elbow = hip_ang = knee_ang = flat_deg = None
        straight = True
        valid = False         # True only when the pose is fully seen AND body is horizontal

        if res.pose_landmarks:
            lm = res.pose_landmarks[0]
            side = LEFT if sum(lm[i].visibility for i in LEFT.values()) >= \
                sum(lm[i].visibility for i in RIGHT.values()) else RIGHT

            if min(lm[i].visibility for i in side.values()) < VIS_MIN:
                status = "Show your full body (side view)"
            else:
                P = {k: self.smooth(i, lm[i].x * w, lm[i].y * h) for k, i in side.items()}
                # lift the knee point slightly upward (compensates for the natural knee droop)
                P["k"] = (P["k"][0], P["k"][1] - KNEE_LIFT * math.dist(P["h"], P["k"]))
                S, E, W, H, K, A = P["s"], P["e"], P["w"], P["h"], P["k"], P["a"]

                elbow = angle(S, E, W)
                hip_ang = angle(S, H, K)        # shoulder-hip-knee
                knee_ang = angle(H, K, A)       # hip-knee-ankle
                straight = hip_ang > STRAIGHT_MIN and knee_ang > STRAIGHT_MIN

                # horizontal check: angle of the shoulder-ankle line against the floor
                flat_deg = math.degrees(math.atan2(abs(S[1] - A[1]), abs(S[0] - A[0])))
                flat = flat_deg < FLAT_MAX_DEG
                valid = flat

                if not flat:
                    status = "Get into pushup position (body must be flat)"
                else:
                    status = "Body straight" if straight else "Keep body straight"

                if draw_overlay:
                    line_col = (0, 255, 0) if (straight and flat) else (0, 0, 255)
                    for a, b in BONES:
                        cv2.line(frame, tuple(map(int, P[a])), tuple(map(int, P[b])), line_col, 3)
                    for pt in P.values():
                        cv2.circle(frame, tuple(map(int, pt)), 6, (255, 255, 255), -1)

                # ----- rep logic (only runs while the body is horizontal) -----
                if flat:
                    if self.in_rep:
                        self.min_elbow = min(self.min_elbow, elbow)
                        self.bent_count = self.bent_count + 1 if not straight else 0
                        self.bent_flag |= self.bent_count >= BAD_FRAMES

                    if self.state == "UP" and not self.in_rep and elbow < UP_ANGLE - 10:
                        self.in_rep, self.min_elbow = True, elbow
                        self.bent_count, self.bent_flag = 0, False
                    if self.state == "UP" and self.in_rep and elbow <= DOWN_ANGLE:
                        self.state = "DOWN"

                    if self.in_rep and elbow > UP_ANGLE:            # back at the top: judge the rep
                        if self.min_elbow > DOWN_ANGLE:
                            reason = "Go lower"
                        elif self.bent_flag:
                            reason = "Keep body straight"
                        else:
                            reason = None
                        if reason:
                            self.bad += 1
                            self.verdict, self.verdict_ok = f"BAD: {reason}", False
                        else:
                            self.good += 1
                            self.verdict, self.verdict_ok = f"Perfect rep #{self.good}", True
                        self.in_rep, self.state = False, "UP"

        # pose lost, key points hidden, or body not horizontal: cancel any rep in progress, no verdict
        if not valid:
            self.in_rep, self.state = False, "UP"

        # FPS calculation
        now_t = time.time()
        self.fps = 0.9 * self.fps + 0.1 / max(now_t - self.prev_t, 1e-6)
        self.prev_t = now_t

        if draw_overlay:
            cv2.putText(frame, f"FPS {self.fps:.0f}  |  {status}", (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
            if elbow is not None:
                cv2.putText(frame, f"elbow {elbow:.0f}  hip {hip_ang:.0f}  knee {knee_ang:.0f}  flat {flat_deg:.0f}  [{self.state}]",
                            (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)
            cv2.putText(frame, f"GOOD {self.good}   BAD {self.bad}", (10, h - 50), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
            if self.verdict:
                cv2.putText(frame, self.verdict, (10, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.9,
                            (0, 200, 0) if self.verdict_ok else (0, 0, 255), 2)

        stats: dict[str, Any] = {
            "state": self.state,
            "in_rep": self.in_rep,
            "good": self.good,
            "bad": self.bad,
            "verdict": self.verdict,
            "verdict_ok": self.verdict_ok,
            "status": status,
            "elbow": round(elbow, 1) if elbow is not None else None,
            "hip_ang": round(hip_ang, 1) if hip_ang is not None else None,
            "knee_ang": round(knee_ang, 1) if knee_ang is not None else None,
            "flat_deg": round(flat_deg, 1) if flat_deg is not None else None,
            "straight": straight,
            "valid": valid,
            "fps": round(self.fps, 1),
        }

        return frame, stats

    def close(self):
        if hasattr(self, "landmarker") and self.landmarker:
            self.landmarker.close()


def main():
    tracker = PushupTracker()
    cap = cv2.VideoCapture(CAM_INDEX)
    if not cap.isOpened():
        print("Could not open the webcam (check camera permission, or try CAM_INDEX = 1).")
        raise SystemExit
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_W)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_H)
    cap.set(cv2.CAP_PROP_FPS, TARGET_FPS)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter.fourcc(*"MJPG"))
    print("Camera reports FPS:", cap.get(cv2.CAP_PROP_FPS))

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame, _ = tracker.process_frame(frame, draw_overlay=True)
        cv2.imshow("Dumbbell Buddhi", frame)
        k = cv2.waitKey(1) & 0xFF
        if k == 27:
            break
        if k == ord("r"):
            tracker.reset()

    tracker.close()
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
