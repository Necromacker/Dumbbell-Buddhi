import math
import os
import time
import urllib.request

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

# ======================= SETTINGS =======================
CAM_INDEX = 0
FRAME_W, FRAME_H, TARGET_FPS = 640, 480, 60

UP_ANGLE = 160        # elbow above this = arms straight (top)
DOWN_ANGLE = 90       # elbow must reach this or lower (bottom)
STRAIGHT_MIN = 160    # shoulder-hip-knee and hip-knee-ankle angles must stay above this
KNEE_LIFT = 0.10      # move the knee point UP by this fraction of the hip-knee length (0 = off, 0.15 = more)
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

if not os.path.exists(MODEL_FILE):
    print("Downloading lite model...")
    try:
        urllib.request.urlretrieve(MODEL_URL, MODEL_FILE)
    except Exception as e:
        print("Download failed:", e, "\nGet it from:", MODEL_URL)
        raise SystemExit

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

landmarker = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
    base_options=mp_python.BaseOptions(model_asset_path=MODEL_FILE),
    running_mode=vision.RunningMode.VIDEO,
    num_poses=1,
    min_pose_detection_confidence=0.5,
    min_pose_presence_confidence=0.5,
    min_tracking_confidence=0.5,
))

prev_pts = {}


def smooth(i, x, y):
    p = prev_pts.get(i)
    if p is None:
        prev_pts[i] = (x, y)
    elif abs(x - p[0]) >= DEAD_PX or abs(y - p[1]) >= DEAD_PX:
        prev_pts[i] = (ALPHA * x + (1 - ALPHA) * p[0], ALPHA * y + (1 - ALPHA) * p[1])
    return prev_pts[i]


def angle(a, b, c):
    """Angle at b (degrees) between points a-b-c."""
    v1 = math.atan2(a[1] - b[1], a[0] - b[0])
    v2 = math.atan2(c[1] - b[1], c[0] - b[0])
    d = abs(math.degrees(v1 - v2))
    return 360 - d if d > 180 else d


# ---------- state ----------
state = "UP"              # UP or DOWN
in_rep = False
min_elbow = 180.0
bent_count = 0
bent_flag = False
good = bad = 0
verdict, verdict_ok = "", True

start_t = time.time()
prev_t = start_t
fps = 0.0

while True:
    ok, frame = cap.read()
    if not ok:
        break
    frame = cv2.flip(frame, 1)
    h, w = frame.shape[:2]

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    res = landmarker.detect_for_video(
        mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb),
        int((time.time() - start_t) * 1000))

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
            P = {k: smooth(i, lm[i].x * w, lm[i].y * h) for k, i in side.items()}
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

            line_col = (0, 255, 0) if (straight and flat) else (0, 0, 255)
            for a, b in BONES:
                cv2.line(frame, tuple(map(int, P[a])), tuple(map(int, P[b])), line_col, 3)
            for pt in P.values():
                cv2.circle(frame, tuple(map(int, pt)), 6, (255, 255, 255), -1)

            # ----- rep logic (only runs while the body is horizontal) -----
            if flat:
                if in_rep:
                    min_elbow = min(min_elbow, elbow)
                    bent_count = bent_count + 1 if not straight else 0
                    bent_flag |= bent_count >= BAD_FRAMES

                if state == "UP" and not in_rep and elbow < UP_ANGLE - 10:
                    in_rep, min_elbow = True, elbow
                    bent_count, bent_flag = 0, False
                if state == "UP" and in_rep and elbow <= DOWN_ANGLE:
                    state = "DOWN"

                if in_rep and elbow > UP_ANGLE:            # back at the top: judge the rep
                    if min_elbow > DOWN_ANGLE:
                        reason = "Go lower"
                    elif bent_flag:
                        reason = "Keep body straight"
                    else:
                        reason = None
                    if reason:
                        bad += 1
                        verdict, verdict_ok = f"BAD: {reason}", False
                    else:
                        good += 1
                        verdict, verdict_ok = f"Perfect rep #{good}", True
                    in_rep, state = False, "UP"

    # pose lost, key points hidden, or body not horizontal: cancel any rep in progress, no verdict
    if not valid:
        in_rep, state = False, "UP"

    # ---------- overlay ----------
    now_t = time.time()
    fps = 0.9 * fps + 0.1 / max(now_t - prev_t, 1e-6)
    prev_t = now_t
    cv2.putText(frame, f"FPS {fps:.0f}  |  {status}", (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
    if elbow is not None:
        cv2.putText(frame, f"elbow {elbow:.0f}  hip {hip_ang:.0f}  knee {knee_ang:.0f}  flat {flat_deg:.0f}  [{state}]",
                    (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)
    cv2.putText(frame, f"GOOD {good}   BAD {bad}", (10, h - 50), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
    if verdict:
        cv2.putText(frame, verdict, (10, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.9,
                    (0, 200, 0) if verdict_ok else (0, 0, 255), 2)

    cv2.imshow("Dumbbell Buddhi", frame)
    k = cv2.waitKey(1) & 0xFF
    if k == 27:
        break
    if k == ord("r"):      # reset
        state, in_rep, good, bad, verdict = "UP", False, 0, 0, ""

landmarker.close()
cap.release()
cv2.destroyAllWindows()