import { useEffect, useRef, useCallback } from 'react';

export default function GestureEngine({
  videoRef,
  canvasRef,
  overlayCanvasRef,
  onAgeChange,
  onFistGesture,
  cancelGeneration,
  currentAge,
  countdown,
}) {
  const handsRef = useRef(null);
  const animFrameRef = useRef(null);
  const lastLandmarksRef = useRef(null);

  // Gesture hold tracking refs
  const activeGestureRef = useRef(null);
  const holdStartTimeRef = useRef(null);
  const actionTriggeredRef = useRef(false);

  // Euclidean distance helper
  const getDistance = (p1, p2) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };

  // Check if a finger is extended relative to the wrist (landmark 0)
  const isFingerExtended = useCallback((landmarks, tipIdx, mcpIdx) => {
    const tipDist = getDistance(landmarks[tipIdx], landmarks[0]);
    const mcpDist = getDistance(landmarks[mcpIdx], landmarks[0]);
    return tipDist > mcpDist * 1.15;
  }, []);

  const resetHoldTracker = useCallback(() => {
    activeGestureRef.current = null;
    holdStartTimeRef.current = null;
    actionTriggeredRef.current = false;
  }, []);

  const drawOverlay = useCallback((landmarks, activeGesture, holdProgress) => {
    const overlay = overlayCanvasRef?.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    const w = overlay.width;
    const h = overlay.height;
    ctx.clearRect(0, 0, w, h);

    // 1. Draw gesture zone boundary line (subtle vertical line at 30% width from left of visual frame)
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(w * 0.3, 0);
    ctx.lineTo(w * 0.3, h);
    ctx.stroke();
    ctx.restore();

    // 2. Draw tracking dot at landmark 9 (middle finger MCP)
    if (landmarks) {
      const lm9 = landmarks[9];
      const x = (1 - lm9.x) * w;
      const y = lm9.y * h;

      ctx.save();
      ctx.fillStyle = '#00ff88';
      ctx.shadowColor = 'rgba(0, 255, 136, 0.6)';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 3. Circular progress ring centered on webcam view
    if (activeGesture && holdProgress > 0) {
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(w, h) * 0.22;

      ctx.save();
      
      // Semi-transparent dark background for better contrast
      ctx.fillStyle = 'rgba(10, 10, 10, 0.55)';
      ctx.fillRect(0, 0, w, h);

      // Background circle path
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      // Progress filled path
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (holdProgress / 100) * Math.PI * 2;
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0, 255, 136, 0.6)';
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, endAngle);
      ctx.stroke();

      // Emoji and text indicators in the center of the ring
      let emoji = '';
      let label = '';
      if (activeGesture === 'fist') { emoji = '✊'; label = 'Pose'; }
      else if (activeGesture === 'up') { emoji = '👆'; label = 'Age Up'; }
      else if (activeGesture === 'down') { emoji = '👇'; label = 'Age Down'; }
      else if (activeGesture === 'cancel') { emoji = '✌️'; label = 'Cancel'; }

      // Emoji
      ctx.fillStyle = '#ffffff';
      ctx.font = '32px system-ui, -apple-system';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, cx, cy - 22);

      // Label description
      ctx.fillStyle = '#a0a0a0';
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.fillText(label.toUpperCase(), cx, cy + 16);

      // Percentage
      ctx.fillStyle = '#00ff88';
      ctx.font = 'bold 20px "JetBrains Mono", monospace';
      ctx.fillText(`${Math.round(holdProgress)}%`, cx, cy + 38);

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
      minDetectionConfidence: 0.85,
      minTrackingConfidence: 0.85,
    });

    hands.onResults((results) => {
      // If we are currently counting down, suspend gesture processing
      if (countdown !== null) {
        resetHoldTracker();
        drawOverlay(null, null, 0);
        return;
      }

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        lastLandmarksRef.current = landmarks;

        const score = results.multiHandedness?.[0]?.score || 0;
        // Gesture zone constraint: detect in the left 30% of the visual frame (screen x <= 0.3, meaning landmarks[0].x >= 0.7)
        const isLeftZone = (1 - landmarks[0].x) <= 0.3;

        if (score > 0.85 && isLeftZone) {
          // Determine extended fingers
          const indexExtended = isFingerExtended(landmarks, 8, 5);
          const middleExtended = isFingerExtended(landmarks, 12, 9);
          const ringExtended = isFingerExtended(landmarks, 16, 13);
          const pinkyExtended = isFingerExtended(landmarks, 20, 17);

          let detectedGesture = null;

          // 1. Fist (✊)
          if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
            detectedGesture = 'fist';
          }
          // 2. Index Pointing (👆/👇)
          else if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
            const dy = landmarks[8].y - landmarks[5].y;
            if (dy < -0.05) {
              detectedGesture = 'up';
            } else if (dy > 0.05) {
              detectedGesture = 'down';
            }
          }
          // 3. Peace/Cancel (✌️)
          else if (indexExtended && middleExtended && !ringExtended && !pinkyExtended) {
            detectedGesture = 'cancel';
          }

          if (detectedGesture) {
            if (activeGestureRef.current !== detectedGesture) {
              activeGestureRef.current = detectedGesture;
              holdStartTimeRef.current = Date.now();
              actionTriggeredRef.current = false;
            } else if (!actionTriggeredRef.current) {
              const elapsed = Date.now() - holdStartTimeRef.current;
              const progress = Math.min(100, (elapsed / 1500) * 100);

              if (elapsed >= 1500) {
                actionTriggeredRef.current = true;
                // Trigger action
                if (detectedGesture === 'fist') {
                  onFistGesture();
                } else if (detectedGesture === 'up') {
                  onAgeChange(Math.min(80, currentAge + 1));
                } else if (detectedGesture === 'down') {
                  onAgeChange(Math.max(0, currentAge - 1));
                } else if (detectedGesture === 'cancel') {
                  cancelGeneration();
                }
              }
              drawOverlay(landmarks, detectedGesture, progress);
            } else {
              drawOverlay(landmarks, detectedGesture, 100);
            }
          } else {
            resetHoldTracker();
            drawOverlay(landmarks, null, 0);
          }
        } else {
          // Hand detected but confidence too low or outside gesture zone
          resetHoldTracker();
          drawOverlay(landmarks, null, 0);
        }
      } else {
        // No hand detected
        lastLandmarksRef.current = null;
        resetHoldTracker();
        drawOverlay(null, null, 0);
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
        // Ignore MediaPipe frame send errors
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
      resetHoldTracker();
      hands.close();
    };
  }, [
    videoRef,
    canvasRef,
    overlayCanvasRef,
    onAgeChange,
    onFistGesture,
    cancelGeneration,
    currentAge,
    countdown,
    isFingerExtended,
    drawOverlay,
    resetHoldTracker,
  ]);

  // Continuous animation frame helper to keep overlay progress ring smooth
  useEffect(() => {
    let running = true;
    function updateProgress() {
      if (!running) return;

      if (
        activeGestureRef.current &&
        holdStartTimeRef.current &&
        !actionTriggeredRef.current &&
        lastLandmarksRef.current
      ) {
        const elapsed = Date.now() - holdStartTimeRef.current;
        const progress = Math.min(100, (elapsed / 1500) * 100);
        drawOverlay(lastLandmarksRef.current, activeGestureRef.current, progress);
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
