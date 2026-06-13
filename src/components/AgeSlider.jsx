import React from 'react';

function getAgeLabel(age) {
  if (age <= 10) return 'Child';
  if (age <= 20) return 'Teen';
  if (age <= 35) return 'Young Adult';
  if (age <= 50) return 'Middle Age';
  if (age <= 65) return 'Senior';
  return 'Elderly';
}

export default function AgeSlider({ currentAge, min = 0, max = 80, onChange }) {
  return (
    <div className="age-slider-interactive">
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={currentAge}
        onChange={(e) => onChange(Number(e.target.value))}
        className="age-slider-range"
      />
      <div className="age-slider-labels-container">
        <span className="age-slider-text-label">{getAgeLabel(currentAge)}</span>
        <span className="age-slider-hint-text">Move UP / DOWN or drag</span>
      </div>
    </div>
  );
}
