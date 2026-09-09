import React from 'react';

function StatusCard({ title, value, unit = '', statusText, statusType = 'normal', icon, subtitle }) {
  return (
    <div className={`status-card status-${statusType}`}>
      <div className="status-card-header">
        <span className="status-card-title">{title}</span>
        <div className="status-card-icon">{icon}</div>
      </div>

      <div className="status-card-body">
        <div className="status-card-value">
          {value}<span className="status-card-unit">{unit}</span>
        </div>
        
        <div className={`status-pill pill-${statusType}`}>
          <span className="pill-dot"></span>
          <span>{statusText}</span>
        </div>
      </div>

      {subtitle && <p className="status-card-subtitle">{subtitle}</p>}
    </div>
  );
}

export default StatusCard;
