import React, { useState, useRef, useCallback, useEffect } from 'react';
import WebcamFeed from './components/WebcamFeed';
import GestureEngine from './components/GestureEngine';
import AgeSlider from './components/AgeSlider';
import TimestampStrip from './components/TimestampStrip';

export default function App() {
  const [userAge, setUserAge] = useState(null);
  const [modalAge, setModalAge] = useState(21);
  const [targetAge, setTargetAge] = useState(21);
  
  // Camera permission flow
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState('prompt'); // 'prompt' | 'granted' | 'denied'
  
  // App dimensions resizing
  const [leftPanelWidth, setLeftPanelWidth] = useState('40%'); // '30%' | '40%' | '60%'

  // API states
  const [apiStatus, setApiStatus] = useState('idle'); // 'idle' | 'loading' | 'error'
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [snapshots, setSnapshots] = useState([]); // Array of snapshots
  const [overlayImage, setOverlayImage] = useState(null);
  const [lastSnapshot, setLastSnapshot] = useState(null); // Keep last captured frame
  
  // Right side panel displays
  const [latestAgedImageUrl, setLatestAgedImageUrl] = useState(null);
  const [timelineVideoUrl, setTimelineVideoUrl] = useState(null);
  const [isVideoLoading, setIsVideoLoading] = useState(false);

  // Countdown overlay state
  const [countdown, setCountdown] = useState(null); // null | 3 | 2 | 1 | 0

  // Queue states for full timeline
  const [generationProgress, setGenerationProgress] = useState(null); // null or { current: number, total: number }
  const activeControllersRef = useRef([]);

  const webcamRef = useRef(null);
  const timelineRef = useRef(null);
  const userAgeRef = useRef(userAge);
  const targetAgeRef = useRef(targetAge);

  // Sync refs for gesture tracking callbacks
  useEffect(() => {
    userAgeRef.current = userAge;
  }, [userAge]);

  useEffect(() => {
    targetAgeRef.current = targetAge;
  }, [targetAge]);

  // Check camera permissions on load
  useEffect(() => {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions
        .query({ name: 'camera' })
        .then((result) => {
          if (result.state === 'granted') {
            setCameraPermissionStatus('granted');
          } else if (result.state === 'denied') {
            setCameraPermissionStatus('denied');
          }
          result.onchange = () => {
            if (result.state === 'granted') {
              setCameraPermissionStatus('granted');
            } else if (result.state === 'denied') {
              setCameraPermissionStatus('denied');
            }
          };
        })
        .catch((err) => {
          console.warn('Permissions API query not fully supported:', err);
        });
    }
  }, []);

  const requestCameraPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
      setCameraPermissionStatus('granted');
    } catch (err) {
      console.error('Camera access denied:', err);
      setCameraPermissionStatus('denied');
    }
  };

  const onAgeChange = useCallback((age) => {
    setTargetAge(age);
  }, []);

  const handleConfirmAge = () => {
    const age = parseInt(modalAge, 10);
    if (!isNaN(age) && age > 0 && age < 120) {
      setUserAge(age);
      setTargetAge(age);
    }
  };

  // Cancel any active generation requests and reset progress
  const cancelGeneration = useCallback(() => {
    console.log('🚫 Cancelling generation queue...');
    activeControllersRef.current.forEach((controller) => controller.abort());
    activeControllersRef.current = [];
    setGenerationProgress(null);
    setApiStatus('idle');
    setIsWakingUp(false);
    
    // Set pending/processing items to error
    setSnapshots((prev) =>
      prev.map((s) =>
        s.status === 'pending' || s.status === 'processing'
          ? { ...s, status: 'error', errorMsg: 'Cancelled' }
          : s
      )
    );
  }, []);

  // Generate target age only
  const generateTargetAgeImage = async (canvas) => {
    if (userAgeRef.current === null) return;
    
    cancelGeneration();
    setApiStatus('loading');
    setTimelineVideoUrl(null); // Clear video view

    // Capture the snapshot image data
    const imageBase64 = canvas.toDataURL('image/jpeg').split(',')[1];
    setLastSnapshot(imageBase64);

    const currentSourceAge = userAgeRef.current;
    const currentTargetAge = targetAgeRef.current;
    const captureTime = new Date().toLocaleTimeString();
    const cardId = `snap-${Date.now()}-${currentTargetAge}`;

    // Create a new card and append it to the strip
    const newCard = {
      id: cardId,
      age: currentTargetAge,
      status: 'processing',
      url: null,
      time: captureTime,
    };

    setSnapshots((prev) => {
      // Avoid duplicate ages in timeline by filtering existing target age if present
      const filtered = prev.filter((s) => s.age !== currentTargetAge);
      return [...filtered, newCard];
    });

    const controller = new AbortController();
    activeControllersRef.current.push(controller);

    let isWaking = false;
    const wakingTimeout = setTimeout(() => {
      isWaking = true;
      setIsWakingUp(true);
    }, 4000);

    try {
      const res = await fetch('/api/age', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'image',
          imageBase64,
          sourceAge: currentSourceAge,
          targetAge: currentTargetAge,
        }),
        signal: controller.signal,
      });

      clearTimeout(wakingTimeout);
      setIsWakingUp(false);

      if (!res.ok) throw new Error('API failed');
      const data = await res.json();
      if (!data.output) throw new Error('No image output returned');

      setSnapshots((prev) =>
        prev.map((s) => (s.id === cardId ? { ...s, status: 'success', url: data.output } : s))
      );
      setLatestAgedImageUrl(data.output);

    } catch (err) {
      clearTimeout(wakingTimeout);
      setIsWakingUp(false);

      if (err.name === 'AbortError') {
        console.log(`Generation aborted for age ${currentTargetAge}`);
      } else {
        console.error('Error generating image:', err);
        setSnapshots((prev) =>
          prev.map((s) => (s.id === cardId ? { ...s, status: 'error', errorMsg: 'Failed' } : s))
        );
        setApiStatus('error');
        setTimeout(() => setApiStatus('idle'), 3000);
      }
    } finally {
      activeControllersRef.current = activeControllersRef.current.filter((c) => c !== controller);
      setApiStatus('idle');
    }
  };

  // Trigger 3s countdown before snapshot
  const triggerFistAction = useCallback(() => {
    if (countdown !== null || apiStatus === 'loading') return;

    setCountdown(3);

    const runCountdown = (current) => {
      if (current > 1) {
        setTimeout(() => {
          setCountdown(current - 1);
          runCountdown(current - 1);
        }, 1000);
      } else {
        setTimeout(() => {
          setCountdown(0); // Show camera emoji 📸
          setTimeout(() => {
            setCountdown(null);
            const canvas = webcamRef.current?.canvasRef?.current;
            if (canvas) {
              generateTargetAgeImage(canvas);
            }
          }, 600);
        }, 1000);
      }
    };

    runCountdown(3);
  }, [countdown, apiStatus]);

  // Generate full timeline steps of 5 (17 images) using lastSnapshot
  const generateFullTimeline = async () => {
    if (!lastSnapshot || userAge === null) return;

    cancelGeneration();
    setApiStatus('loading');
    setTimelineVideoUrl(null);

    const agesToGenerate = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];
    const captureTime = new Date().toLocaleTimeString();

    // Replace the timeline strip with the 17 pending cards
    const initialBatch = agesToGenerate.map((age) => ({
      id: `snap-${Date.now()}-${age}`,
      age: age,
      status: 'pending',
      url: null,
      time: captureTime,
    }));

    setSnapshots(initialBatch);
    setGenerationProgress({ current: 0, total: agesToGenerate.length });

    let completedCount = 0;

    for (let i = 0; i < agesToGenerate.length; i++) {
      const targetAgeValue = agesToGenerate[i];
      const cardId = initialBatch[i].id;

      setSnapshots((prev) =>
        prev.map((s) => (s.id === cardId ? { ...s, status: 'processing' } : s))
      );

      const controller = new AbortController();
      activeControllersRef.current.push(controller);

      let isWaking = false;
      const wakingTimeout = setTimeout(() => {
        isWaking = true;
        setIsWakingUp(true);
      }, 4000);

      try {
        const res = await fetch('/api/age', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'image',
            imageBase64: lastSnapshot,
            sourceAge: userAge,
            targetAge: targetAgeValue,
          }),
          signal: controller.signal,
        });

        clearTimeout(wakingTimeout);
        setIsWakingUp(false);

        if (!res.ok) throw new Error('API failed');
        const data = await res.json();
        if (!data.output) throw new Error('No image output returned');

        setSnapshots((prev) =>
          prev.map((s) => (s.id === cardId ? { ...s, status: 'success', url: data.output } : s))
        );

        // Update main preview panel with this card if it matches the current target age
        if (targetAgeValue === targetAgeRef.current) {
          setLatestAgedImageUrl(data.output);
        }

        completedCount++;
        setGenerationProgress({ current: completedCount, total: agesToGenerate.length });

      } catch (err) {
        clearTimeout(wakingTimeout);
        setIsWakingUp(false);

        if (err.name === 'AbortError') {
          console.log(`Generation aborted for age ${targetAgeValue}`);
          break; // Stop running remainder of queue
        }

        console.error(`Error generating age ${targetAgeValue}:`, err);
        setSnapshots((prev) =>
          prev.map((s) => (s.id === cardId ? { ...s, status: 'error', errorMsg: 'Failed' } : s))
        );
      } finally {
        activeControllersRef.current = activeControllersRef.current.filter((c) => c !== controller);
      }
    }

    setApiStatus('idle');
    setGenerationProgress(null);
  };

  // Generate video using stored lastSnapshot
  const handleGenerateVideo = async () => {
    if (!lastSnapshot || userAge === null) return;
    
    setIsVideoLoading(true);
    setTimelineVideoUrl(null);

    try {
      const res = await fetch('/api/age', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'video',
          imageBase64: lastSnapshot,
          sourceAge: userAge,
          targetAge: 80,
          duration: 5,
          fps: 24,
        }),
      });

      if (!res.ok) throw new Error('Video generation failed');
      const data = await res.json();
      if (!data.output) throw new Error('No video URL returned');

      setTimelineVideoUrl(data.output);
    } catch (err) {
      console.error('Video generation error:', err);
      setApiStatus('error');
      setTimeout(() => setApiStatus('idle'), 3000);
    } finally {
      setIsVideoLoading(false);
    }
  };

  // Download aged image helper
  const downloadImage = async (url, age) => {
    if (!url) return;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `agewarp-age-${age}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download failed, opening in tab:', err);
      window.open(url, '_blank');
    }
  };

  const deleteSnapshot = useCallback((idToDelete, e) => {
    e.stopPropagation();
    setSnapshots((prev) => prev.filter((s) => s.id !== idToDelete));
  }, []);

  const onCardClick = useCallback((snap) => {
    setOverlayImage(snap);
  }, []);

  return (
    <div className="app-container">
      {/* Camera Permission Screen */}
      {cameraPermissionStatus !== 'granted' && (
        <div className="permission-screen-overlay">
          <div className="permission-screen">
            <div className="permission-screen__icon">📷</div>
            <h2 className="permission-screen__title">Camera Access Required</h2>
            <p className="permission-screen__text">
              AgeWarp needs camera access to detect your face and gestures.
            </p>
            {cameraPermissionStatus === 'denied' ? (
              <div className="permission-screen__error">
                Camera access is required to use AgeWarp. Please allow camera access in your browser settings and refresh the page.
              </div>
            ) : (
              <button className="permission-screen__btn" onClick={requestCameraPermission}>
                Allow Camera Access
              </button>
            )}
          </div>
        </div>
      )}

      {/* Age Setup Modal */}
      {cameraPermissionStatus === 'granted' && userAge === null && (
        <div className="age-modal-overlay">
          <div className="age-modal">
            <h2 className="age-modal__title">What is your current age?</h2>
            <div className="age-modal__input-wrapper">
              <input
                className="age-modal__input"
                type="number"
                min="1"
                max="120"
                value={modalAge}
                onChange={(e) => setModalAge(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmAge();
                }}
                autoFocus
              />
            </div>
            <button className="age-modal__btn" onClick={handleConfirmAge}>
              Confirm
            </button>
          </div>
        </div>
      )}

      {/* Split Screen Layout */}
      <div className="split-layout">
        {/* Left Side: Webcam & Controls */}
        <div className="split-left" style={{ width: leftPanelWidth }}>
          <div className="status-badge-inline">
            <div
              className={`status-badge-inline__dot${
                apiStatus === 'error'
                  ? ' status-badge-inline__dot--error'
                  : apiStatus === 'loading'
                  ? ' status-badge-inline__dot--loading'
                  : ''
              }`}
            />
            <span>
              {apiStatus === 'idle' && 'AgeWarp Ready'}
              {apiStatus === 'loading' && (isWakingUp ? 'Waking up AI...' : 'Processing...')}
              {apiStatus === 'error' && 'Error'}
            </span>
          </div>

          <div className="webcam-panel">
            {cameraPermissionStatus === 'granted' && (
              <WebcamFeed
                ref={webcamRef}
                apiStatus={apiStatus}
                currentAge={targetAge}
                isWakingUp={isWakingUp}
                countdown={countdown}
              />
            )}
            
            {/* Gesture Hint Bar */}
            <div className="gesture-hint-bar">
              <div className="gesture-hint">✊ <span>Capture</span></div>
              <div className="gesture-hint">☝️ <span>+1 Age</span></div>
              <div className="gesture-hint">👇 <span>-1 Age</span></div>
              <div className="gesture-hint">✌️ <span>Cancel</span></div>
            </div>
          </div>

          {/* Resizable Webcam Width Bar */}
          <div className="webcam-resize-bar">
            <button
              className={`resize-btn ${leftPanelWidth === '30%' ? 'active' : ''}`}
              onClick={() => setLeftPanelWidth('30%')}
              title="Shrink webcam layout"
            >
              ⊖ Shrink (30%)
            </button>
            <button
              className={`resize-btn ${leftPanelWidth === '40%' ? 'active' : ''}`}
              onClick={() => setLeftPanelWidth('40%')}
              title="Default webcam layout"
            >
              ⊙ Default (40%)
            </button>
            <button
              className={`resize-btn ${leftPanelWidth === '60%' ? 'active' : ''}`}
              onClick={() => setLeftPanelWidth('60%')}
              title="Expand webcam layout"
            >
              ⊕ Expand (60%)
            </button>
          </div>

          {/* Interactive Controls Panel */}
          {userAge !== null && (
            <div className="controls-panel">
              {/* Dual Age Display */}
              <div className="age-display-header">
                You: <span className="age-display-header__src">{userAge}</span> → Target: <span className="age-display-header__dest">{targetAge}</span>
              </div>

              {/* Age Slider */}
              <AgeSlider currentAge={targetAge} min={0} max={80} onChange={onAgeChange} />

              {/* Action Buttons */}
              <div className="action-buttons-group">
                <button
                  className="action-btn action-btn--timeline"
                  onClick={generateFullTimeline}
                  disabled={!lastSnapshot || apiStatus === 'loading'}
                >
                  📅 Generate Full Timeline (0-80)
                </button>
                <button
                  className="action-btn action-btn--video"
                  onClick={handleGenerateVideo}
                  disabled={!lastSnapshot || isVideoLoading || apiStatus === 'loading'}
                >
                  {isVideoLoading ? 'Generating Video...' : '📹 Generate Video'}
                </button>
              </div>

              {apiStatus === 'loading' && (
                <button className="action-btn action-btn--cancel" onClick={cancelGeneration}>
                  🛑 Cancel Generation
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right Side: Main visualizer */}
        <div className="split-right" style={{ width: `calc(100% - ${leftPanelWidth})` }}>
          {timelineVideoUrl ? (
            <div className="visualizer-video-wrapper">
              <video className="visualizer-video" src={timelineVideoUrl} controls autoPlay loop />
            </div>
          ) : latestAgedImageUrl ? (
            <div className="visualizer-image-wrapper">
              <img className="visualizer-image" src={latestAgedImageUrl} alt="Aged Result" />
              <button
                className="visualizer-download-btn"
                onClick={() => downloadImage(latestAgedImageUrl, targetAge)}
                title="Download Image"
              >
                ⬇ Download Image
              </button>
            </div>
          ) : (
            /* Empty Right Panel */
            <div className="visualizer-placeholder">
              <div className="visualizer-placeholder__silhouette">
                <svg viewBox="0 0 100 120" className="face-silhouette">
                  <path
                    d="M50,15 C32,15 22,28 22,48 C22,64 26,72 32,84 C38,96 42,102 50,102 C58,102 62,96 68,84 C74,72 78,64 78,48 C78,28 68,15 50,15 Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    className="face-silhouette__oval"
                  />
                  <path
                    d="M30,110 C35,95 40,90 50,90 C60,90 65,95 70,110"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    className="face-silhouette__shoulders"
                  />
                  <circle cx="40" cy="48" r="2" fill="var(--accent)" className="face-silhouette__node" />
                  <circle cx="60" cy="48" r="2" fill="var(--accent)" className="face-silhouette__node" />
                  <path d="M47,60 Q50,62 53,60" fill="none" stroke="var(--accent)" strokeWidth="1.5" className="face-silhouette__node" />
                </svg>
                <div className="visualizer-placeholder__age-glow">{targetAge}</div>
              </div>
              <div className="visualizer-placeholder__instruction">
                <span className="gesture-icon">✊</span> Hold for 1.5s to generate
              </div>
            </div>
          )}

          {/* Sequential queue loading overlay */}
          {generationProgress && (
            <div className="queue-overlay">
              <div className="queue-overlay__spinner" />
              <div className="queue-overlay__text">Generating Timeline...</div>
              <div className="queue-overlay__progress-text">
                {generationProgress.current} / {generationProgress.total} ages completed
              </div>
              <div className="queue-overlay__bar-container">
                <div
                  className="queue-overlay__bar-fill"
                  style={{ width: `${(generationProgress.current / generationProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Timeline Strip (at the bottom) */}
      {userAge !== null && (
        <TimestampStrip
          ref={timelineRef}
          snapshots={snapshots}
          onCardClick={onCardClick}
          onDeleteClick={deleteSnapshot}
          onDownloadClick={downloadImage}
          targetAge={targetAge}
        />
      )}

      {/* Fullscreen Overlay */}
      {overlayImage && (
        <div className="fullscreen-overlay" onClick={() => setOverlayImage(null)}>
          <div className="fullscreen-overlay__close-hint">ESC or click to close</div>
          {overlayImage.status === 'success' && overlayImage.url ? (
            <>
              <img className="fullscreen-overlay__img" src={overlayImage.url} alt={`Age ${overlayImage.age}`} />
              <div className="fullscreen-overlay__label">
                Age {overlayImage.age} • {overlayImage.time}
              </div>
              <button
                className="fullscreen-overlay__download-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadImage(overlayImage.url, overlayImage.age);
                }}
              >
                ⬇ Download
              </button>
            </>
          ) : (
            <div className="fullscreen-overlay__loading">
              <div className="fullscreen-overlay__loading-spinner" />
              <div className="fullscreen-overlay__loading-text">
                {overlayImage.status === 'processing' ? 'Processing Age ' : 'Pending Age '} {overlayImage.age}...
              </div>
              {(overlayImage.status === 'processing' || overlayImage.status === 'pending') && (
                <button
                  className="fullscreen-overlay__cancel-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelGeneration();
                    setOverlayImage(null);
                  }}
                >
                  Cancel Generation
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Gesture Engine mounts after webcam */}
      {userAge !== null && webcamRef.current && (
        <GestureEngine
          videoRef={webcamRef.current.videoRef}
          canvasRef={webcamRef.current.canvasRef}
          overlayCanvasRef={webcamRef.current.overlayCanvasRef}
          onAgeChange={onAgeChange}
          onFistGesture={triggerFistAction}
          cancelGeneration={cancelGeneration}
          currentAge={targetAge}
          countdown={countdown}
        />
      )}

      {/* Error toast */}
      {apiStatus === 'error' && (
        <div className="error-toast">⚠ API request failed. Try again.</div>
      )}
    </div>
  );
}
