import React, { useState, useRef, useCallback, useEffect } from 'react';
import WebcamFeed from './components/WebcamFeed';
import GestureEngine from './components/GestureEngine';
import AgeSlider from './components/AgeSlider';
import TimestampStrip from './components/TimestampStrip';

export default function App() {
  const [userAge, setUserAge] = useState(null);
  const [modalAge, setModalAge] = useState(21);
  const [targetAge, setTargetAge] = useState(21);
  
  const [apiStatus, setApiStatus] = useState('idle'); // 'idle' | 'loading' | 'error'
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [snapshots, setSnapshots] = useState([]); // Array of snapshots
  const [overlayImage, setOverlayImage] = useState(null);
  
  // Right side panel displays
  const [latestAgedImageUrl, setLatestAgedImageUrl] = useState(null);
  const [timelineVideoUrl, setTimelineVideoUrl] = useState(null);
  const [isVideoLoading, setIsVideoLoading] = useState(false);

  // Queue states
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

  // Sequential generation of ages 0, 10, 20, 30, 40, 50, 60, 70, 80
  const onSnapshot = useCallback(async (canvas) => {
    if (userAgeRef.current === null) return;
    
    // Cancel any active generation queue first
    cancelGeneration();

    const currentSourceAge = userAgeRef.current;
    const agesToGenerate = [0, 10, 20, 30, 40, 50, 60, 70, 80];
    
    console.log('📸 Capturing snapshot. Triggering sequential timeline aging queue...');
    setApiStatus('loading');
    setTimelineVideoUrl(null); // Clear video when generating new timeline

    // Capture the snapshot image data once
    const imageBase64 = canvas.toDataURL('image/jpeg').split(',')[1];
    const captureTime = new Date().toLocaleTimeString();

    // 1. Pre-populate timeline with loading/pending cards
    const initialBatch = agesToGenerate.map((age) => ({
      id: `snap-${Date.now()}-${age}`,
      age: age,
      status: 'pending', // 'pending' | 'processing' | 'success' | 'error'
      url: null,
      time: captureTime,
    }));

    setSnapshots(initialBatch);
    setGenerationProgress({ current: 0, total: agesToGenerate.length });

    // 2. Sequentially fetch each age
    let completedCount = 0;
    
    for (let i = 0; i < agesToGenerate.length; i++) {
      const targetAgeValue = agesToGenerate[i];
      const cardId = initialBatch[i].id;

      // Update card status to processing
      setSnapshots((prev) =>
        prev.map((s) => (s.id === cardId ? { ...s, status: 'processing' } : s))
      );

      const controller = new AbortController();
      activeControllersRef.current.push(controller);

      // Timeout helper for waking up notification
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
            targetAge: targetAgeValue,
          }),
          signal: controller.signal,
        });

        clearTimeout(wakingTimeout);
        setIsWakingUp(false);

        if (!res.ok) {
          throw new Error('API failed');
        }

        const data = await res.json();
        if (!data.output) throw new Error('No image output returned');

        // Update the card on success
        setSnapshots((prev) =>
          prev.map((s) =>
            s.id === cardId ? { ...s, status: 'success', url: data.output } : s
          )
        );

        // Update main preview panel with this latest image
        setLatestAgedImageUrl(data.output);

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
          prev.map((s) =>
            s.id === cardId ? { ...s, status: 'error', errorMsg: 'Failed' } : s
          )
        );
      } finally {
        // Remove this controller from active list
        activeControllersRef.current = activeControllersRef.current.filter((c) => c !== controller);
      }
    }

    setApiStatus('idle');
    setGenerationProgress(null);
  }, [cancelGeneration]);

  // Generate video logic
  const handleGenerateVideo = async () => {
    if (snapshots.length === 0 || !webcamRef.current) return;
    
    // Capture latest webcam frame to use as source
    const canvas = webcamRef.current.canvasRef.current;
    if (!canvas) return;

    setIsVideoLoading(true);
    setTimelineVideoUrl(null);

    try {
      const imageBase64 = canvas.toDataURL('image/jpeg').split(',')[1];
      const res = await fetch('/api/age', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'video',
          imageBase64,
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

  const deleteSnapshot = useCallback((idToDelete, e) => {
    e.stopPropagation(); // Prevent opening card detail
    setSnapshots((prev) => prev.filter((s) => s.id !== idToDelete));
  }, []);

  const onCardClick = useCallback((snap) => {
    setOverlayImage(snap);
  }, []);

  return (
    <div className="app-container">
      {/* Age Setup Modal */}
      {userAge === null && (
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

      {/* Redesigned Split Screen Layout */}
      <div className="split-layout">
        {/* Left Side (40%): Webcam, controls, slider */}
        <div className="split-left">
          {/* Status badge */}
          <div className="status-badge-inline">
            <div className={`status-badge-inline__dot${apiStatus === 'error' ? ' status-badge-inline__dot--error' : apiStatus === 'loading' ? ' status-badge-inline__dot--loading' : ''}`} />
            <span>
              {apiStatus === 'idle' && 'AgeWarp Ready'}
              {apiStatus === 'loading' && (isWakingUp ? 'Waking up AI...' : 'Processing...')}
              {apiStatus === 'error' && 'Error'}
            </span>
          </div>

          <div className="webcam-panel">
            <WebcamFeed
              ref={webcamRef}
              apiStatus={apiStatus}
              currentAge={targetAge}
              isWakingUp={isWakingUp}
            />
            
            {/* Gesture Hint Bar */}
            <div className="gesture-hint-bar">
              <div className="gesture-hint">✊ <span>Generate Timeline</span></div>
              <div className="gesture-hint">☝️ <span>Age Up</span></div>
              <div className="gesture-hint">👇 <span>Age Down</span></div>
              <div className="gesture-hint">✌️ <span>Cancel</span></div>
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
                  className="action-btn action-btn--video"
                  onClick={handleGenerateVideo}
                  disabled={snapshots.length === 0 || isVideoLoading || apiStatus === 'loading'}
                >
                  {isVideoLoading ? 'Generating Video...' : '📹 Generate Video'}
                </button>
                {apiStatus === 'loading' && (
                  <button className="action-btn action-btn--cancel" onClick={cancelGeneration}>
                    🛑 Cancel Generation
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Side (60%): Main visualizer */}
        <div className="split-right">
          {timelineVideoUrl ? (
            <div className="visualizer-video-wrapper">
              <video className="visualizer-video" src={timelineVideoUrl} controls autoPlay loop />
            </div>
          ) : latestAgedImageUrl ? (
            <div className="visualizer-image-wrapper">
              <img className="visualizer-image" src={latestAgedImageUrl} alt="Aged Result" />
            </div>
          ) : (
            <div className="visualizer-placeholder">
              <div className="visualizer-placeholder__icon">✊</div>
              <div className="visualizer-placeholder__text">Hold fist to generate your timeline</div>
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
          onSnapshot={onSnapshot}
          timelineRef={timelineRef}
          cancelGeneration={cancelGeneration}
          currentAge={targetAge}
        />
      )}

      {/* Error toast */}
      {apiStatus === 'error' && (
        <div className="error-toast">⚠ API request failed. Try again.</div>
      )}
    </div>
  );
}
