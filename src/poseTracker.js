import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// Settings matching Model.py
const UP_ANGLE = 160;
const DOWN_ANGLE = 90;
const STRAIGHT_MIN = 160;
const KNEE_LIFT = 0.15;
const FLAT_MAX_DEG = 35;
const BAD_FRAMES = 6;
const VIS_MIN = 0.5;
const ALPHA = 0.5;
const DEAD_PX = 2.0;

const LEFT = { s: 11, e: 13, w: 15, h: 23, k: 25, a: 27 };
const RIGHT = { s: 12, e: 14, w: 16, h: 24, k: 26, a: 28 };

function angle(a, b, c) {
  const v1 = Math.atan2(a[1] - b[1], a[0] - b[0]);
  const v2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
  let d = Math.abs((v1 - v2) * (180 / Math.PI));
  return d > 180 ? 360 - d : d;
}

export class BrowserPushupTracker {
  constructor(onRepCallback) {
    this.onRep = onRepCallback;
    this.landmarker = null;
    this.prevPts = {};
    this.state = 'UP';
    this.inRep = false;
    this.minElbow = 180.0;
    this.bentCount = 0;
    this.bentFlag = false;
    this.good = 0;
    this.bad = 0;
    this.verdict = '';
    this.verdictOk = true;
    this.isReady = false;
  }

  async initialize() {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      this.isReady = true;
      return true;
    } catch (err) {
      console.warn('MediaPipe initialization fallback:', err);
      return false;
    }
  }

  smooth(i, x, y) {
    const p = this.prevPts[i];
    if (!p) {
      this.prevPts[i] = [x, y];
    } else if (Math.abs(x - p[0]) >= DEAD_PX || Math.abs(y - p[1]) >= DEAD_PX) {
      this.prevPts[i] = [
        ALPHA * x + (1 - ALPHA) * p[0],
        ALPHA * y + (1 - ALPHA) * p[1]
      ];
    }
    return this.prevPts[i];
  }

  reset() {
    this.state = 'UP';
    this.inRep = false;
    this.minElbow = 180.0;
    this.bentCount = 0;
    this.bentFlag = false;
    this.good = 0;
    this.bad = 0;
    this.verdict = '';
    this.verdictOk = true;
    this.prevPts = {};
  }

  processVideoFrame(videoElement, timestamp) {
    if (!this.isReady || !this.landmarker || !videoElement || videoElement.readyState < 2) {
      return null;
    }

    let results = null;
    try {
      results = this.landmarker.detectForVideo(videoElement, timestamp);
    } catch (e) {
      return null;
    }

    if (!results || !results.landmarks || results.landmarks.length === 0) {
      this.inRep = false;
      this.state = 'UP';
      return null;
    }

    const lm = results.landmarks[0];
    const w = videoElement.videoWidth || 640;
    const h = videoElement.videoHeight || 480;

    // Check which side has higher visibility
    const leftVis = Object.values(LEFT).reduce((sum, idx) => sum + (lm[idx]?.visibility || 0), 0);
    const rightVis = Object.values(RIGHT).reduce((sum, idx) => sum + (lm[idx]?.visibility || 0), 0);
    const side = leftVis >= rightVis ? LEFT : RIGHT;

    // Check minimum visibility
    const minVis = Math.min(...Object.values(side).map((idx) => lm[idx]?.visibility || 0));
    if (minVis < VIS_MIN) {
      this.inRep = false;
      this.state = 'UP';
      return null;
    }

    // Points smoothed
    const P = {};
    for (const [k, idx] of Object.entries(side)) {
      P[k] = this.smooth(idx, lm[idx].x * w, lm[idx].y * h);
    }

    // Lift knee slightly
    const hipKneeDist = Math.hypot(P.h[0] - P.k[0], P.h[1] - P.k[1]);
    P.k = [P.k[0], P.k[1] - KNEE_LIFT * hipKneeDist];

    const S = P.s;
    const E = P.e;
    const W = P.w;
    const H = P.h;
    const K = P.k;
    const A = P.a;

    const elbow = angle(S, E, W);
    const hipAng = angle(S, H, K);
    const kneeAng = angle(H, K, A);
    const straight = hipAng > STRAIGHT_MIN && kneeAng > STRAIGHT_MIN;

    const flatDeg = Math.abs(Math.atan2(Math.abs(S[1] - A[1]), Math.abs(S[0] - A[0])) * (180 / Math.PI));
    const flat = flatDeg < FLAT_MAX_DEG;

    if (!flat) {
      this.inRep = false;
      this.state = 'UP';
      return { elbow, straight, flat: false, good: this.good, bad: this.bad };
    }

    // Rep State Machine (only runs while body is horizontal)
    if (this.inRep) {
      this.minElbow = Math.min(this.minElbow, elbow);
      this.bentCount = !straight ? this.bentCount + 1 : 0;
      this.bentFlag = this.bentFlag || this.bentCount >= BAD_FRAMES;
    }

    if (this.state === 'UP' && !this.inRep && elbow < UP_ANGLE - 10) {
      this.inRep = true;
      this.minElbow = elbow;
      this.bentCount = 0;
      this.bentFlag = false;
    }

    if (this.state === 'UP' && this.inRep && elbow <= DOWN_ANGLE) {
      this.state = 'DOWN';
    }

    // Returning to the top (judge the rep)
    if (this.inRep && elbow > UP_ANGLE) {
      if (this.minElbow > DOWN_ANGLE) {
        this.bad += 1;
        this.verdict = 'Go lower';
        this.verdictOk = false;
      } else if (this.bentFlag) {
        this.bad += 1;
        this.verdict = 'Keep body straight';
        this.verdictOk = false;
      } else {
        this.good += 1;
        this.verdict = `Perfect rep #${this.good}`;
        this.verdictOk = true;
        if (this.onRep) {
          this.onRep(this.good);
        }
      }
      this.inRep = false;
      this.state = 'UP';
    }

    return {
      elbow,
      straight,
      flat,
      good: this.good,
      bad: this.bad,
      verdict: this.verdict,
      verdictOk: this.verdictOk
    };
  }
}
