import React, { useRef, forwardRef, useImperativeHandle } from 'react';

const TimestampStrip = forwardRef(function TimestampStrip({ snapshots, onCardClick, onDeleteClick, onDownloadClick, targetAge }, ref) {
  const stripRef = useRef(null);

  useImperativeHandle(ref, () => stripRef.current);

  if (snapshots.length === 0) {
    return (
      <div className="timeline-strip timeline-strip--empty" ref={stripRef}>
        <div className="timeline-strip__empty-text">No timeline snapshots generated yet.</div>
      </div>
    );
  }

  return (
    <div className="timeline-strip" ref={stripRef}>
      {snapshots.map((snap) => {
        const isSuccess = !snap.status || snap.status === 'success';
        const isPending = snap.status === 'pending';
        const isProcessing = snap.status === 'processing';
        const isError = snap.status === 'error';
        const isHighlighted = snap.age === targetAge;

        return (
          <div
            key={snap.id}
            className={`timeline-card ${isPending ? 'timeline-card--pending' : ''} ${
              isProcessing ? 'timeline-card--pending timeline-card--processing' : ''
            } ${isError ? 'timeline-card--error-state' : ''} ${
              isHighlighted && isSuccess ? 'timeline-card--highlighted' : ''
            }`}
            onClick={() => onCardClick(snap)}
          >
            {/* Card Delete Button (Top Right) */}
            <button
              className="timeline-card__delete-btn"
              onClick={(e) => onDeleteClick(snap.id, e)}
              title="Delete Card"
            >
              ✕
            </button>

            {/* Card Download Button (Top Left) */}
            {isSuccess && snap.url && (
              <button
                className="timeline-card__download-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onDownloadClick(snap.url, snap.age);
                }}
                title="Download Card"
              >
                ⬇
              </button>
            )}

            {isSuccess && snap.url && (
              <>
                <img
                  className="timeline-card__img"
                  src={snap.url}
                  alt={`Age ${snap.age}`}
                  loading="lazy"
                />
                <div className="timeline-card__info">
                  <div className="timeline-card__age">Age {snap.age}</div>
                </div>
              </>
            )}

            {(isPending || isProcessing) && (
              <div className="timeline-card__loader-wrapper" style={{ textAlign: 'center', padding: '12px 0' }}>
                <div className="timeline-card__loader" style={{ margin: '0 auto 8px auto' }} />
                <div className="timeline-card__loader-text">
                  {isProcessing ? 'Aging...' : 'Pending'}
                </div>
                <div className="timeline-card__age" style={{ marginTop: '4px' }}>Age {snap.age}</div>
              </div>
            )}

            {isError && (
              <div className="timeline-card__error-wrapper" style={{ textAlign: 'center', padding: '12px 0' }}>
                <div style={{ fontSize: '16px', marginBottom: '6px', color: 'var(--error)' }}>⚠</div>
                <div className="timeline-card__loader-text" style={{ color: 'var(--error)' }}>
                  {snap.errorMsg || 'Failed'}
                </div>
                <div className="timeline-card__age" style={{ color: 'var(--text-muted)', marginTop: '4px' }}>Age {snap.age}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

export default TimestampStrip;
