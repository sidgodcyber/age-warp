import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';

const WebcamFeed = forwardRef(function WebcamFeed({ apiStatus, currentAge, isWakingUp, countdown }, ref) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const [cameraError, setCameraError] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  // Expose refs to parent
  useImperativeHandle(ref, () => ({
    videoRef,
    canvasRef,
    overlayCanvasRef,
  }));

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let stream = null;
    let cancelled = false;

    setCameraError(false);
    setCameraReady(false);

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        video.srcObject = stream;
        await video.play();

        if (cancelled) return;

        setCameraReady(true);

        // Set canvas size to match video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Also set overlay canvas size
        if (overlayCanvasRef.current) {
          overlayCanvasRef.current.width = video.videoWidth;
          overlayCanvasRef.current.height = video.videoHeight;
        }

        renderLoop();
      } catch (err) {
        if (cancelled) return;
        if (err.name === 'NotAllowedError' || err.name === 'NotFoundError') {
          console.error('Camera access denied:', err);
          setCameraError(true);
        } else {
          console.warn('Camera init interrupted:', err.name);
        }
      }
    }

    function renderLoop() {
      if (cancelled) return;
      const ctx = canvas.getContext('2d');
      if (!ctx || video.paused || video.ended) return;

      const w = canvas.width;
      const h = canvas.height;

      // Mirror the video
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -w, 0, w, h);
      ctx.restore();

      // Draw face oval guide
      drawFaceOval(ctx, w, h);

      animFrameRef.current = requestAnimationFrame(renderLoop);
    }

    function drawFaceOval(ctx, w, h) {
      const cx = w / 2;
      const cy = h / 2;
      const rx = w * 0.19;
      const ry = h * 0.26;

      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    startCamera();

    return () => {
      cancelled = true;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return (
    <div className="webcam-wrapper">
      <video ref={videoRef} className="hidden-video" playsInline muted />
      <canvas ref={canvasRef} className="webcam-canvas" />
      <canvas ref={overlayCanvasRef} className="overlay-canvas" />
      <div className="scanline-overlay" />

      {/* Gesture Zone Divider and Indicator Box */}
      {cameraReady && (
        <>
          <div className="gesture-zone-line" />
          <div className="gesture-zone-box">
            <span className="gesture-zone-box__icon">👋</span>
            <span className="gesture-zone-box__text">Show hand here</span>
          </div>
        </>
      )}

      {/* 3-Second Countdown Overlay */}
      {countdown !== null && (
        <div className="countdown-overlay">
          <div className="countdown-number">
            {countdown === 0 ? '📸' : countdown}
          </div>
        </div>
      )}

      {cameraError && (
        <div className="camera-error">
          <div className="camera-error__icon">🚫</div>
          <div className="camera-error__title">Camera Access Blocked</div>
          <div className="camera-error__msg">
            Please allow camera permissions in your browser settings and refresh the page.
          </div>
        </div>
      )}

      {apiStatus === 'loading' && countdown === null && (
        <div className="loading-overlay-custom">
          <div className="loading-overlay-custom__icon">⏳</div>
          <div className="loading-overlay-custom__text">
            {isWakingUp ? 'Waking up AI...' : 'Aging...'}
          </div>
          <div className="loading-overlay-custom__subtext">
            {isWakingUp
              ? 'Please wait, booting the free Hugging Face Space (first call takes 30-60s).'
              : `Generating age ${currentAge} • ~15 seconds`}
          </div>
          <div className="loading-overlay-custom__progress">
            <div className="loading-overlay-custom__progress-bar" />
          </div>
        </div>
      )}
    </div>
  );
});

export default WebcamFeed;
