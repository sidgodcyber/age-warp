import { useEffect, useRef, useCallback } from 'react';

const FIST_HOLD_MS = 1000; // 1 second hold for generation
const AGE_ADJUST_COOLDOWN_MS = 800; // Cooldown between increments

export default function GestureEngine({
  videoRef,
  canvasRef,
  overlayCanvasRef,
  onAgeChange,
  onSnapshot,
  cancelGeneration,
  currentAge,
}) {
  const handsRef = useRef(null);
  const fistTimerRef = useRef(null);
  const fistStartTimeRef = useRef(null);
  const isFistRef = useRef(false);
  const animFrameRef = useRef(null);
  const lastLandmarksRef = useRef(null);
  const lastAgeAdjustTimeRef = useRef(0);

  // Euclidean distance helper
  const getDistance = (p1, p2) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };

  // Generic check to see if a finger is extended relative to the wrist (landmark 0)
  const isFingerExtended = useCallback((landmarks, tipIdx, mcpIdx) => {
    const tipDist = getDistance(landmarks[tipIdx], landmarks[0]);
    const mcpDist = getDistance(landmarks[mcpIdx], landmarks[0]);
    return tipDist > mcpDist * 1.15;
  }, []);

  const drawOverlay = useCallback((landmarks, isFist, holdProgress) => {
    const overlay = overlayCanvasRef?.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    const w = overlay.width;
    const h = overlay.height;
    ctx.clearRect(0, 0, w, h);

    // Landmark 9 position (mirrored)
    const lm9 = landmarks[9];
    const x = (1 - lm9.x) * w;
    const y = lm9.y * h;

    // Draw tracking dot at landmark 9 (middle finger MCP)
    ctx.save();
    ctx.fillStyle = '#00ff88';
    ctx.shadowColor = 'rgba(0, 255, 136, 0.6)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // If fist detected, draw glow on face oval
    if (isFist) {
      const cx = w / 2;
      const cy = h / 2;
      const rx = w * 0.19;
      const ry = h * 0.26;

      ctx.save();
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.5)';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(0, 255, 136, 0.3)';
      ctx.shadowBlur = 20;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Fist hold progress arc
    if (isFist && holdProgress > 0) {
      const arcRadius = 24;
      const endAngle = (holdProgress / 100) * Math.PI * 2 - Math.PI / 2;

      // Background circle
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y - 40, arcRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Progress arc
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0, 255, 136, 0.5)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(x, y - 40, arcRadius, -Math.PI / 2, endAngle);
      ctx.stroke();

      // Percentage text
      ctx.fillStyle = '#00ff88';
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(holdProgress)}%`, x, y - 40);
      ctx.restore();
    }
  }, [overlayCanvasRef]);

  useEffect(() => {
    const video = videoRef?.current;
    if (!video || !window.Hands) return;

    const hands = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5,
    });

    hands.onResults((results) => {
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        lastLandmarksRef.current = landmarks;

        // Determine extended fingers
        const indexExtended = isFingerExtended(landmarks, 8, 5);
        const middleExtended = isFingerExtended(landmarks, 12, 9);
        const ringExtended = isFingerExtended(landmarks, 16, 13);
        const pinkyExtended = isFingerExtended(landmarks, 20, 17);

        // 1. Fist (✊): all 4 folded
        const isFist = !indexExtended && !middleExtended && !ringExtended && !pinkyExtended;

        // 2. Index Only (👆/👇): index extended, others folded
        const isIndexOnly = indexExtended && !middleExtended && !ringExtended && !pinkyExtended;

        // 3. Peace (✌️): index and middle extended, others folded
        const isPeace = indexExtended && middleExtended && !ringExtended && !pinkyExtended;

        // --- Action: Peace gesture to cancel ---
        if (isPeace) {
          cancelGeneration();
        }

        // --- Action: Index point up/down to adjust age ---
        const now = Date.now();
        if (isIndexOnly && now - lastAgeAdjustTimeRef.current > AGE_ADJUST_COOLDOWN_MS) {
          // Vector from MCP to tip
          const dy = landmarks[8].y - landmarks[5].y;
          if (dy < -0.05) {
            // Index pointing UP: targetAge + 5
            onAgeChange(Math.min(80, currentAge + 5));
            lastAgeAdjustTimeRef.current = now;
          } else if (dy > 0.05) {
            // Index pointing DOWN: targetAge - 5
            onAgeChange(Math.max(0, currentAge - 5));
            lastAgeAdjustTimeRef.current = now;
          }
        }

        // --- Action: Fist Hold for Snapshot timeline ---
        const wasFist = isFistRef.current;

        if (isFist && !wasFist) {
          isFistRef.current = true;
          fistStartTimeRef.current = Date.now();
          fistTimerRef.current = setTimeout(() => {
            const canvas = canvasRef?.current;
            if (canvas) {
              onSnapshot(canvas);
            }
            fistStartTimeRef.current = null;
          }, FIST_HOLD_MS);
        } else if (!isFist && wasFist) {
          isFistRef.current = false;
          if (fistTimerRef.current) {
            clearTimeout(fistTimerRef.current);
            fistTimerRef.current = null;
          }
          fistStartTimeRef.current = null;
        }

        // --- Draw Overlay animations ---
        let holdProgress = 0;
        if (isFistRef.current && fistStartTimeRef.current) {
          const elapsed = Date.now() - fistStartTimeRef.current;
          holdProgress = Math.min(100, (elapsed / FIST_HOLD_MS) * 100);
        }
        drawOverlay(landmarks, isFistRef.current, holdProgress);
      } else {
        // No hand detected
        lastLandmarksRef.current = null;
        isFistRef.current = false;
        if (fistTimerRef.current) {
          clearTimeout(fistTimerRef.current);
          fistTimerRef.current = null;
        }
        fistStartTimeRef.current = null;

        const overlay = overlayCanvasRef?.current;
        if (overlay) {
          const ctx = overlay.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
        }
      }
    });

    handsRef.current = hands;

    let running = true;
    async function sendFrame() {
      if (!running || !video || video.paused || video.ended || video.readyState < 2) {
        if (running) animFrameRef.current = requestAnimationFrame(sendFrame);
        return;
      }

      try {
        await hands.send({ image: video });
      } catch (err) {
        // Ignore MediaPipe transient frame errors
      }

      if (running) {
        animFrameRef.current = requestAnimationFrame(sendFrame);
      }
    }

    const checkReady = setInterval(() => {
      if (video.readyState >= 2) {
        clearInterval(checkReady);
        sendFrame();
      }
    }, 100);

    return () => {
      running = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      clearInterval(checkReady);
      if (fistTimerRef.current) clearTimeout(fistTimerRef.current);
      hands.close();
    };
  }, [
    videoRef,
    canvasRef,
    overlayCanvasRef,
    onAgeChange,
    onSnapshot,
    cancelGeneration,
    currentAge,
    isFingerExtended,
    drawOverlay,
  ]);

  // Continuous overlay progress updater
  useEffect(() => {
    let running = true;
    function updateProgress() {
      if (!running) return;

      if (isFistRef.current && fistStartTimeRef.current && lastLandmarksRef.current) {
        const elapsed = Date.now() - fistStartTimeRef.current;
        const holdProgress = Math.min(100, (elapsed / FIST_HOLD_MS) * 100);
        drawOverlay(lastLandmarksRef.current, true, holdProgress);
      }

      requestAnimationFrame(updateProgress);
    }

    updateProgress();
    return () => {
      running = false;
    };
  }, [drawOverlay]);

  return null;
}
