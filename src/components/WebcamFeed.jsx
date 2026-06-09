import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';

const WebcamFeed = forwardRef(function WebcamFeed({ apiStatus, currentAge, isWakingUp }, ref) {
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

    // Reset error on each mount (fixes StrictMode double-mount stale error)
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

        // If cleanup ran while we were awaiting, stop the new stream and bail
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

        // Start rendering loop
        renderLoop();
      } catch (err) {
        if (cancelled) return; // Don't set error if we were cleaned up
        // Only show error for actual permission denial, not AbortError from StrictMode cleanup
        if (err.name === 'NotAllowedError' || err.name === 'NotFoundError') {
          console.error('Camera access denied:', err);
          setCameraError(true);
        } else {
          console.warn('Camera init interrupted (likely StrictMode remount):', err.name);
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
      const rx = w * 0.19; // ~38% width diameter = 19% radius
      const ry = h * 0.26; // ~52% height diameter = 26% radius

      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
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

      {cameraError && (
        <div className="camera-error">
          <div className="camera-error__icon">🚫</div>
          <div className="camera-error__title">Camera Access Blocked</div>
          <div className="camera-error__msg">
            Please allow camera permissions in your browser settings and refresh the page.
          </div>
        </div>
      )}

      {apiStatus === 'loading' && (
        <div className="loading-overlay">
          <div className="loading-overlay__icon">⏳</div>
          <div className="loading-overlay__text">
            {isWakingUp ? 'Waking up AI...' : 'Aging...'}
          </div>
          <div className="loading-overlay__subtext">
            {isWakingUp
              ? 'Please wait, booting the free Hugging Face Space (first call takes 30-60s).'
              : `Generating age ${currentAge} • ~15 seconds`}
          </div>
          <div className="loading-overlay__progress">
            <div className="loading-overlay__progress-bar" />
          </div>
        </div>
      )}
    </div>
  );
});

export default WebcamFeed;
