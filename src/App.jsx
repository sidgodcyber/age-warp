import React, { useState, useRef, useCallback, useEffect } from 'react';
import WebcamFeed from './components/WebcamFeed';
import GestureEngine from './components/GestureEngine';
import AgeSlider from './components/AgeSlider';

export default function App() {
  const [userAge, setUserAge] = useState(null);
  const [modalAge, setModalAge] = useState(21);
  const [targetAge, setTargetAge] = useState(21);
  
  // Camera permission flow
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState('prompt'); // 'prompt' | 'granted' | 'denied'
  
  // App dimensions resizing
  const [leftPanelWidth, setLeftPanelWidth] = useState('60%'); // '30%' | '40%' | '60%'
  const [isWebcamExpanded, setIsWebcamExpanded] = useState(false);

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

  // Handle ESC key to close lightbox overlay
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOverlayImage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
    console.log('Cancelling generation queue...');
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

    } finally {
      activeControllersRef.current = activeControllersRef.current.filter((c) => c !== controller);
      setApiStatus('idle');
    }
  };

  const retryGeneration = async (snap) => {
    if (!lastSnapshot || userAge === null) return;

    const cardId = snap.id;
    const currentTargetAge = snap.age;

    // Set card status to processing
    setSnapshots((prev) =>
      prev.map((s) => (s.id === cardId ? { ...s, status: 'processing', errorMsg: null } : s))
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
      
      if (currentTargetAge === targetAgeRef.current) {
        setLatestAgedImageUrl(data.output);
      }

    } catch (err) {
      clearTimeout(wakingTimeout);
      setIsWakingUp(false);

      if (err.name === 'AbortError') {
        console.log(`Generation aborted for age ${currentTargetAge}`);
      } else {
        console.error('Error retrying image generation:', err);
        setSnapshots((prev) =>
          prev.map((s) => (s.id === cardId ? { ...s, status: 'error', errorMsg: 'Failed' } : s))
        );
      }
    } finally {
      activeControllersRef.current = activeControllersRef.current.filter((c) => c !== controller);
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
      setOverlayImage({
        id: `video-${Date.now()}`,
        status: 'success',
        url: data.output,
        age: `${userAge}-80 Video`,
        time: new Date().toLocaleTimeString(),
        isVideo: true
      });
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
            <div className="permission-screen__icon"></div>
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

          <div className={`webcam-panel ${isWebcamExpanded ? 'webcam-panel--expanded' : ''}`}>
            {cameraPermissionStatus === 'granted' && (
              <WebcamFeed
                ref={webcamRef}
                apiStatus={apiStatus}
                currentAge={targetAge}
                isWakingUp={isWakingUp}
                countdown={countdown}
              />
            )}

            {/* Expand webcam height button */}
            <button
              className="webcam-expand-btn"
              onClick={() => setIsWebcamExpanded(!isWebcamExpanded)}
              title={isWebcamExpanded ? "Collapse webcam height" : "Expand webcam height"}
            >
              ⤢
            </button>
            
            {/* Gesture Hint Bar */}
            <div className="gesture-hint-bar">
              <div className="gesture-hint"><span>CAPTURE</span></div>
              <div className="gesture-hint"><span>AGE +</span></div>
              <div className="gesture-hint"><span>AGE −</span></div>
              <div className="gesture-hint"><span>CANCEL</span></div>
            </div>
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
                  GENERATE TIMELINE
                </button>
                <button
                  className="action-btn action-btn--video"
                  onClick={handleGenerateVideo}
                  disabled={!lastSnapshot || isVideoLoading || apiStatus === 'loading'}
                >
                  {isVideoLoading ? 'GENERATING VIDEO...' : 'GENERATE VIDEO'}
                </button>
              </div>

              {apiStatus === 'loading' && (
                <button className="action-btn action-btn--cancel" onClick={cancelGeneration}>
                  CANCEL GENERATION
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right Side: Scrollable snapshot gallery */}
        <div 
          className={`split-right${snapshots.length === 0 ? ' split-right--empty' : ''}`} 
          style={{ width: `calc(100% - ${leftPanelWidth})` }}
        >
          {snapshots.length === 0 ? (
            <div className="visualizer-placeholder-message">
              CAPTURE A PHOTO TO BEGIN
            </div>
          ) : (
            <div className="snapshot-grid">
              {snapshots.map((snap) => {
                const isSuccess = !snap.status || snap.status === 'success';
                const isPending = snap.status === 'pending';
                const isProcessing = snap.status === 'processing';
                const isError = snap.status === 'error';

                return (
                  <div
                    key={snap.id}
                    className={`snapshot-card ${isPending ? 'snapshot-card--pending' : ''} ${
                      isProcessing ? 'snapshot-card--pending snapshot-card--processing' : ''
                    } ${isError ? 'snapshot-card--error-state' : ''}`}
                    onClick={() => isSuccess && snap.url && onCardClick(snap)}
                  >
                    {isSuccess && snap.url && (
                      <>
                        <img
                          className="snapshot-card__img"
                          src={snap.url}
                          alt={`Age ${snap.age}`}
                          loading="lazy"
                        />
                        <div className="snapshot-card__actions">
                          <button
                            className="snapshot-card__btn snapshot-card__btn--download"
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadImage(snap.url, snap.age);
                            }}
                            title="Download Card"
                          >
                            ↓
                          </button>
                          <button
                            className="snapshot-card__btn snapshot-card__btn--delete"
                            onClick={(e) => deleteSnapshot(snap.id, e)}
                            title="Delete Card"
                          >
                            ✕
                          </button>
                        </div>
                      </>
                    )}

                    {(isPending || isProcessing) && (
                      <div className="snapshot-card__loader-wrapper">
                        <div className="snapshot-card__loader" />
                        <div className="snapshot-card__loader-text">
                          {isProcessing ? 'Aging...' : 'Pending'}
                        </div>
                      </div>
                    )}

                    {isError && (
                      <div className="snapshot-card__error-wrapper" onClick={(e) => e.stopPropagation()}>
                        <div className="snapshot-card__error-text">
                          ✕ Failed
                        </div>
                        <button
                          className="snapshot-card__retry-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            retryGeneration(snap);
                          }}
                        >
                          Retry
                        </button>
                      </div>
                    )}

                    <div className="snapshot-card__label">Age {snap.age}</div>
                  </div>
                );
              })}
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

      {/* Fullscreen Overlay */}
      {overlayImage && (
        <div className="fullscreen-overlay" onClick={() => setOverlayImage(null)}>
          <div className="fullscreen-overlay__close-hint">ESC or click outside to close</div>
          {overlayImage.status === 'success' && overlayImage.url ? (
            <div className="fullscreen-overlay__content" onClick={(e) => e.stopPropagation()}>
              {overlayImage.isVideo ? (
                <video className="fullscreen-overlay__video" src={overlayImage.url} controls autoPlay loop />
              ) : (
                <img className="fullscreen-overlay__img" src={overlayImage.url} alt={`Age ${overlayImage.age}`} />
              )}
              <div className="fullscreen-overlay__label">
                Age {overlayImage.age} • {overlayImage.time}
              </div>
              <button
                className="fullscreen-overlay__download-btn"
                onClick={() => {
                  downloadImage(overlayImage.url, overlayImage.age);
                }}
              >
                DOWNLOAD
              </button>
            </div>
          ) : (
            <div className="fullscreen-overlay__loading" onClick={(e) => e.stopPropagation()}>
              <div className="fullscreen-overlay__loading-spinner" />
              <div className="fullscreen-overlay__loading-text">
                {overlayImage.status === 'processing' ? 'Processing Age ' : 'Pending Age '} {overlayImage.age}...
              </div>
              {(overlayImage.status === 'processing' || overlayImage.status === 'pending') && (
                <button
                  className="fullscreen-overlay__cancel-btn"
                  onClick={() => {
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
        <div className="error-toast">API request failed. Try again.</div>
      )}
    </div>
  );
}
