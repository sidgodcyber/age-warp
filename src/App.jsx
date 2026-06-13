import React, { useState, useRef, useCallback, useEffect } from 'react';
import WebcamFeed from './components/WebcamFeed';
import GestureEngine from './components/GestureEngine';
import AgeSlider from './components/AgeSlider';

export default function App() {
  const [userAge, setUserAge] = useState(null);
  const [modalAge, setModalAge] = useState('');
  const [targetAge, setTargetAge] = useState(21);
  const [showWelcome, setShowWelcome] = useState(true);

  const [cameraPermissionStatus, setCameraPermissionStatus] = useState('prompt');
  const [leftPanelWidth, setLeftPanelWidth] = useState('60%');
  const [isWebcamExpanded, setIsWebcamExpanded] = useState(false);

  const [apiStatus, setApiStatus] = useState('idle');
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [generatingAge, setGeneratingAge] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [overlayImage, setOverlayImage] = useState(null);
  const [lastSnapshot, setLastSnapshot] = useState(null);

  const [latestAgedImageUrl, setLatestAgedImageUrl] = useState(null);
  const [timelineVideoUrl, setTimelineVideoUrl] = useState(null);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('images');

  const [countdown, setCountdown] = useState(null);
  const [statusBarState, setStatusBarState] = useState(null);

  const activeControllersRef = useRef([]);
  const webcamRef = useRef(null);
  const userAgeRef = useRef(userAge);
  const targetAgeRef = useRef(targetAge);

  useEffect(() => { userAgeRef.current = userAge; }, [userAge]);
  useEffect(() => { targetAgeRef.current = targetAge; }, [targetAge]);

  // Camera permission check
  useEffect(() => {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'camera' })
        .then((result) => {
          if (result.state === 'granted') setCameraPermissionStatus('granted');
          else if (result.state === 'denied') setCameraPermissionStatus('denied');
          result.onchange = () => {
            if (result.state === 'granted') setCameraPermissionStatus('granted');
            else if (result.state === 'denied') setCameraPermissionStatus('denied');
          };
        })
        .catch(() => {});
    }
  }, []);

  const requestCameraPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      setCameraPermissionStatus('granted');
    } catch {
      setCameraPermissionStatus('denied');
    }
  };

  const onAgeChange = useCallback((age) => setTargetAge(age), []);

  const ageNum = parseInt(modalAge, 10);
  const isValidAge = !isNaN(ageNum) && ageNum >= 0 && ageNum <= 120 && modalAge.toString().trim() !== '';
  const showAgeError = modalAge !== '' && (isNaN(ageNum) || ageNum < 0 || ageNum > 120);

  const handleConfirmAge = () => {
    if (isValidAge) {
      setUserAge(ageNum);
      setTargetAge(Math.min(ageNum, 80));
    }
  };

  const cancelGeneration = useCallback(() => {
    activeControllersRef.current.forEach((c) => c.abort());
    activeControllersRef.current = [];
    setStatusBarState(null);
    setApiStatus('idle');
    setGeneratingAge(null);
    setIsWakingUp(false);
    setSnapshots((prev) =>
      prev.map((s) =>
        s.status === 'pending' || s.status === 'processing'
          ? { ...s, status: 'error', errorMsg: 'Cancelled' }
          : s
      )
    );
  }, []);

  // Stable ref so keydown handler can call it without stale closure
  const generateFnRef = useRef(null);

  const generateTargetAgeImage = useCallback(async (canvas) => {
    if (userAgeRef.current === null) return;

    cancelGeneration();
    setApiStatus('loading');
    setGeneratingAge(targetAgeRef.current);
    setTimelineVideoUrl(null);

    const imageBase64 = canvas.toDataURL('image/jpeg').split(',')[1];
    setLastSnapshot(imageBase64);

    const currentSourceAge = userAgeRef.current;
    const currentTargetAge = targetAgeRef.current;
    const captureTime = new Date().toLocaleTimeString();
    const cardId = `snap-${Date.now()}-${currentTargetAge}`;

    setSnapshots((prev) => [
      ...prev.filter((s) => s.age !== currentTargetAge),
      { id: cardId, age: currentTargetAge, status: 'processing', url: null, time: captureTime },
    ]);

    const controller = new AbortController();
    activeControllersRef.current.push(controller);
    const wakingTimeout = setTimeout(() => setIsWakingUp(true), 4000);

    try {
      const res = await fetch('/api/age', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'image', imageBase64, sourceAge: currentSourceAge, targetAge: currentTargetAge }),
        signal: controller.signal,
      });
      clearTimeout(wakingTimeout);
      setIsWakingUp(false);
      if (!res.ok) throw new Error('API failed');
      const data = await res.json();
      if (!data.output) throw new Error('No image output');
      setSnapshots((prev) => prev.map((s) => s.id === cardId ? { ...s, status: 'success', url: data.output } : s));
      setLatestAgedImageUrl(data.output);
    } catch (err) {
      clearTimeout(wakingTimeout);
      setIsWakingUp(false);
      if (err.name !== 'AbortError') {
        setSnapshots((prev) => prev.map((s) => s.id === cardId ? { ...s, status: 'error', errorMsg: 'Failed' } : s));
        setApiStatus('error');
        setTimeout(() => setApiStatus('idle'), 3000);
      }
    } finally {
      activeControllersRef.current = activeControllersRef.current.filter((c) => c !== controller);
      setApiStatus((s) => s === 'loading' ? 'idle' : s);
      setGeneratingAge(null);
    }
  }, [cancelGeneration]);

  // Keep ref up to date
  useEffect(() => { generateFnRef.current = generateTargetAgeImage; }, [generateTargetAgeImage]);

  // Keydown shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOverlayImage(null);
      } else if (e.key.toLowerCase() === 's') {
        const canvas = webcamRef.current?.canvasRef?.current;
        if (canvas) generateFnRef.current?.(canvas);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const retryGeneration = useCallback(async (snap) => {
    if (!snap || userAgeRef.current === null) return;
    const { id: cardId, age: currentTargetAge } = snap;
    setSnapshots((prev) => prev.map((s) => s.id === cardId ? { ...s, status: 'processing', errorMsg: null } : s));

    const controller = new AbortController();
    activeControllersRef.current.push(controller);
    const wakingTimeout = setTimeout(() => setIsWakingUp(true), 4000);

    try {
      const res = await fetch('/api/age', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'image', imageBase64: snap.lastSnapshot, sourceAge: userAgeRef.current, targetAge: currentTargetAge }),
        signal: controller.signal,
      });
      clearTimeout(wakingTimeout);
      setIsWakingUp(false);
      if (!res.ok) throw new Error('API failed');
      const data = await res.json();
      if (!data.output) throw new Error('No image output');
      setSnapshots((prev) => prev.map((s) => s.id === cardId ? { ...s, status: 'success', url: data.output } : s));
      if (currentTargetAge === targetAgeRef.current) setLatestAgedImageUrl(data.output);
    } catch (err) {
      clearTimeout(wakingTimeout);
      setIsWakingUp(false);
      if (err.name !== 'AbortError') {
        setSnapshots((prev) => prev.map((s) => s.id === cardId ? { ...s, status: 'error', errorMsg: 'Failed' } : s));
      }
    } finally {
      activeControllersRef.current = activeControllersRef.current.filter((c) => c !== controller);
    }
  }, []);

  const triggerFistAction = useCallback(() => {
    if (countdown !== null || apiStatus === 'loading') return;
    setCountdown(3);
    const runCountdown = (current) => {
      if (current > 1) {
        setTimeout(() => { setCountdown(current - 1); runCountdown(current - 1); }, 1000);
      } else {
        setTimeout(() => {
          setCountdown(0);
          setTimeout(() => {
            setCountdown(null);
            const canvas = webcamRef.current?.canvasRef?.current;
            if (canvas) generateFnRef.current?.(canvas);
          }, 600);
        }, 1000);
      }
    };
    runCountdown(3);
  }, [countdown, apiStatus]);

  const generateFullTimeline = async () => {
    if (!lastSnapshot || userAge === null) return;
    cancelGeneration();
    setApiStatus('loading');
    setTimelineVideoUrl(null);

    const ages = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];
    const captureTime = new Date().toLocaleTimeString();
    const batch = ages.map((age) => ({ id: `snap-${Date.now()}-${age}`, age, status: 'pending', url: null, time: captureTime }));
    setSnapshots(batch);
    setStatusBarState({ status: 'generating', current: 0, total: ages.length });

    let done = 0;
    for (let i = 0; i < ages.length; i++) {
      const age = ages[i];
      const cardId = batch[i].id;
      setSnapshots((prev) => prev.map((s) => s.id === cardId ? { ...s, status: 'processing' } : s));

      const controller = new AbortController();
      activeControllersRef.current.push(controller);
      const wakingTimeout = setTimeout(() => setIsWakingUp(true), 4000);

      try {
        const res = await fetch('/api/age', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'image', imageBase64: lastSnapshot, sourceAge: userAge, targetAge: age }),
          signal: controller.signal,
        });
        clearTimeout(wakingTimeout);
        setIsWakingUp(false);
        if (!res.ok) throw new Error('API failed');
        const data = await res.json();
        if (!data.output) throw new Error('No image output');
        setSnapshots((prev) => prev.map((s) => s.id === cardId ? { ...s, status: 'success', url: data.output } : s));
        if (age === targetAgeRef.current) setLatestAgedImageUrl(data.output);
        done++;
        setStatusBarState({ status: 'generating', current: done, total: ages.length });
      } catch (err) {
        clearTimeout(wakingTimeout);
        setIsWakingUp(false);
        if (err.name === 'AbortError') break;
        setSnapshots((prev) => prev.map((s) => s.id === cardId ? { ...s, status: 'error', errorMsg: 'Failed' } : s));
      } finally {
        activeControllersRef.current = activeControllersRef.current.filter((c) => c !== controller);
      }
    }
    setApiStatus('idle');
    setGeneratingAge(null);
    setStatusBarState({ status: 'complete', current: ages.length, total: ages.length });
    setTimeout(() => setStatusBarState(null), 3000);
  };

  const handleGenerateVideo = async () => {
    if (!lastSnapshot || userAge === null) return;
    setIsVideoLoading(true);
    setTimelineVideoUrl(null);
    setActiveTab('video');
    try {
      const res = await fetch('/api/age', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'video', imageBase64: lastSnapshot, sourceAge: 0, targetAge: 80, duration: 5, fps: 24 }),
      });
      if (!res.ok) throw new Error('Video failed');
      const data = await res.json();
      if (!data.output) throw new Error('No video URL');
      setTimelineVideoUrl(data.output);
    } catch {
      setApiStatus('error');
      setTimeout(() => setApiStatus('idle'), 3000);
    } finally {
      setIsVideoLoading(false);
    }
  };

  const downloadFile = async (url, name, isVideo = false) => {
    if (!url) return;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = isVideo ? `agewarp-${name}.mp4` : `agewarp-age-${name}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, '_blank');
    }
  };

  const deleteSnapshot = useCallback((id, e) => {
    e.stopPropagation();
    setSnapshots((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const onCardClick = useCallback((snap) => setOverlayImage(snap), []);

  return (
    <div className="app-container">
      {/* Welcome Screen */}
      {showWelcome && cameraPermissionStatus === 'granted' && (
        <div className="welcome-overlay">
          <div className="welcome-screen">
            <h1 className="welcome-screen__title">
              WELCOME TO<br />AGEWARP
            </h1>
            <p className="welcome-screen__subtitle">Your AI Powered Time Machine</p>
            <p className="welcome-screen__description">
              Travel back to see your past self or travel into the future to see what your future self will look like.
            </p>
            <button className="welcome-screen__btn" onClick={() => setShowWelcome(false)}>
              Next
            </button>
          </div>
        </div>
      )}

      {/* Camera Permission */}
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
                Camera access is blocked. Please allow it in your browser settings and refresh.
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
            <h2 className="age-modal__title">How old are you?</h2>
            <div className="age-modal__input-wrapper">
              <input
                className="age-modal__input"
                type="number"
                min="0"
                max="120"
                placeholder="25"
                value={modalAge}
                onChange={(e) => setModalAge(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && isValidAge) handleConfirmAge(); }}
                autoFocus
              />
            </div>
            {showAgeError && (
              <div className="age-modal__error">Please enter a valid age (0–120)</div>
            )}
            <button className="age-modal__btn" onClick={handleConfirmAge} disabled={!isValidAge}>
              Confirm
            </button>
          </div>
        </div>
      )}

      {/* Split Layout */}
      <div className="split-layout">
        {/* Left */}
        <div className="split-left" style={{ width: leftPanelWidth }}>
          <div className="status-badge-inline">
            <div className={`status-badge-inline__dot${
              apiStatus === 'error' ? ' status-badge-inline__dot--error' :
              apiStatus === 'loading' ? ' status-badge-inline__dot--loading' : ''
            }`} />
            <span>
              {apiStatus === 'idle' && 'AgeWarp Ready'}
              {apiStatus === 'loading' && (isWakingUp ? 'Waking up AI...' : 'Processing...')}
              {apiStatus === 'error' && 'Error — retrying'}
            </span>
          </div>

          <div className={`webcam-panel ${isWebcamExpanded ? 'webcam-panel--expanded' : ''}`}>
            {cameraPermissionStatus === 'granted' && (
              <WebcamFeed
                ref={webcamRef}
                apiStatus={apiStatus}
                generatingAge={generatingAge}
                isWakingUp={isWakingUp}
                countdown={countdown}
              />
            )}
            <button
              className="webcam-expand-btn"
              onClick={() => setIsWebcamExpanded(!isWebcamExpanded)}
              title={isWebcamExpanded ? 'Collapse' : 'Expand'}
            >
              ⤢
            </button>
          </div>

          {/* Gesture hint bar — pure text, no SVGs */}
          <div className="gesture-instruction-bar">
            <div className="gesture-instruction-item">
              <div className="gesture-instruction-emoji">✊</div>
              <div className="gesture-instruction-text-1">FIST</div>
              <div className="gesture-instruction-text-2">hold to capture</div>
            </div>
            <div className="gesture-instruction-item">
              <div className="gesture-instruction-emoji">☝</div>
              <div className="gesture-instruction-text-1">INDEX ↑</div>
              <div className="gesture-instruction-text-2">age +</div>
            </div>
            <div className="gesture-instruction-item">
              <div className="gesture-instruction-emoji">👇</div>
              <div className="gesture-instruction-text-1">INDEX ↓</div>
              <div className="gesture-instruction-text-2">age −</div>
            </div>
            <div className="gesture-instruction-item">
              <div className="gesture-instruction-emoji">✌</div>
              <div className="gesture-instruction-text-1">PEACE</div>
              <div className="gesture-instruction-text-2">cancel</div>
            </div>
          </div>

          {userAge !== null && (
            <div className="controls-panel">
              <div className="age-display-header">
                You: <span className="age-display-header__src">{userAge}</span>
                {' → '}
                Target: <span className="age-display-header__dest">{targetAge}</span>
              </div>
              <AgeSlider currentAge={targetAge} min={0} max={80} onChange={onAgeChange} />
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
                  {isVideoLoading ? 'GENERATING...' : 'GENERATE VIDEO'}
                </button>
              </div>
              {apiStatus === 'loading' && (
                <button className="action-btn action-btn--cancel" onClick={cancelGeneration}>
                  CANCEL
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right */}
        <div className="split-right" style={{ width: `calc(100% - ${leftPanelWidth})` }}>
          <div className="right-panel-tabs">
            <button
              className={`right-panel-tab${activeTab === 'images' ? ' right-panel-tab--active' : ''}`}
              onClick={() => setActiveTab('images')}
            >
              IMAGES
            </button>
            <button
              className={`right-panel-tab${activeTab === 'video' ? ' right-panel-tab--active' : ''}`}
              onClick={() => setActiveTab('video')}
            >
              VIDEO
            </button>
          </div>

          {statusBarState && (
            <div className="status-bar-top">
              <span className="status-bar-top__text">
                {statusBarState.status === 'generating' ? 'GENERATING' : 'COMPLETE'} {statusBarState.current} / {statusBarState.total}
              </span>
              <div className="status-bar-top__progress-container">
                <div
                  className="status-bar-top__progress-fill"
                  style={{ width: `${(statusBarState.current / statusBarState.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {activeTab === 'images' ? (
            snapshots.length === 0 ? (
              <div className="visualizer-placeholder-message">CAPTURE A PHOTO TO BEGIN</div>
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
                      className={[
                        'snapshot-card',
                        isPending ? 'snapshot-card--pending' : '',
                        isProcessing ? 'snapshot-card--pending snapshot-card--processing' : '',
                        isError ? 'snapshot-card--error-state' : '',
                      ].join(' ').trim()}
                      onClick={() => isSuccess && snap.url && onCardClick(snap)}
                    >
                      {isSuccess && snap.url && (
                        <>
                          <img className="snapshot-card__img" src={snap.url} alt={`Age ${snap.age}`} loading="lazy" />
                          <div className="snapshot-card__actions">
                            <button
                              className="snapshot-card__btn snapshot-card__btn--download"
                              onClick={(e) => { e.stopPropagation(); downloadFile(snap.url, snap.age); }}
                              title="Download"
                            >↓</button>
                            <button
                              className="snapshot-card__btn snapshot-card__btn--delete"
                              onClick={(e) => deleteSnapshot(snap.id, e)}
                              title="Delete"
                            >✕</button>
                          </div>
                        </>
                      )}
                      {(isPending || isProcessing) && (
                        <div className="snapshot-card__loader-wrapper">
                          <div className="snapshot-card__loader" />
                          <div className="snapshot-card__loader-text">{isProcessing ? 'Aging...' : 'Pending'}</div>
                        </div>
                      )}
                      {isError && (
                        <>
                          <button className="snapshot-card__failed-delete-btn" onClick={(e) => deleteSnapshot(snap.id, e)}>✕</button>
                          <div className="snapshot-card__error-wrapper" onClick={(e) => e.stopPropagation()}>
                            <div className="snapshot-card__error-text">Failed</div>
                            <button className="snapshot-card__retry-btn" onClick={(e) => { e.stopPropagation(); retryGeneration(snap); }}>
                              Retry
                            </button>
                          </div>
                        </>
                      )}
                      <div className="snapshot-card__label">Age {snap.age}</div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <div className="video-tab-panel">
              {isVideoLoading ? (
                <div className="video-tab-panel__generating">
                  <div className="video-tab-spinner" />
                  <div className="video-tab-panel__generating-text">GENERATING VIDEO</div>
                </div>
              ) : !timelineVideoUrl ? (
                <div className="video-tab-panel__placeholder">
                  Click GENERATE VIDEO to create an aging timelapse
                </div>
              ) : (
                <div className="video-tab-panel__content">
                  <video className="video-tab-panel__video" src={timelineVideoUrl} controls autoPlay loop />
                  <button className="video-tab-panel__download-btn" onClick={() => downloadFile(timelineVideoUrl, 'timelapse', true)}>
                    DOWNLOAD VIDEO
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen Overlay */}
      {overlayImage && (
        <div className="fullscreen-overlay" onClick={() => setOverlayImage(null)}>
          <div className="fullscreen-overlay__close-hint">ESC or click to close</div>
          {overlayImage.status === 'success' && overlayImage.url ? (
            <div className="fullscreen-overlay__content" onClick={(e) => e.stopPropagation()}>
              <img className="fullscreen-overlay__img" src={overlayImage.url} alt={`Age ${overlayImage.age}`} />
              <div className="fullscreen-overlay__label">Age {overlayImage.age} · {overlayImage.time}</div>
              <button className="fullscreen-overlay__download-btn" onClick={() => downloadFile(overlayImage.url, overlayImage.age)}>
                DOWNLOAD
              </button>
            </div>
          ) : (
            <div className="fullscreen-overlay__loading" onClick={(e) => e.stopPropagation()}>
              <div className="fullscreen-overlay__loading-spinner" />
              <div className="fullscreen-overlay__loading-text">
                {overlayImage.status === 'processing' ? 'Processing' : 'Pending'} Age {overlayImage.age}...
              </div>
              {(overlayImage.status === 'processing' || overlayImage.status === 'pending') && (
                <button className="fullscreen-overlay__cancel-btn" onClick={() => { cancelGeneration(); setOverlayImage(null); }}>
                  Cancel Generation
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Gesture Engine */}
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

      {apiStatus === 'error' && (
        <div className="error-toast">API request failed. Try again.</div>
      )}
    </div>
  );
}
