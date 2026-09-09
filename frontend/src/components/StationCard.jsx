import React from 'react';

function StationCard({ station, onBookClick }) {
  const isAvailable = station.availableChargers > 0;
  const occupancyPercentage = Math.round(
    ((station.totalChargers - station.availableChargers) / station.totalChargers) * 100
  );

  return (
    <div className={`station-card ${!isAvailable ? 'station-full' : ''}`}>
      {/* Header */}
      <div className="station-card-header">
        <div className="station-title-group">
          <h3 className="station-name">{station.name}</h3>
          <p className="station-location">
            <span className="location-icon">📍</span> {station.location} • <span className="distance-badge">{station.distance}</span>
          </p>
        </div>
        <span className={`status-badge ${isAvailable ? 'badge-available' : 'badge-occupied'}`}>
          <span className="badge-dot"></span>
          {isAvailable ? 'Available' : 'Fully Occupied'}
        </span>
      </div>

      {/* Details Grid */}
      <div className="station-details-grid">
        <div className="detail-box">
          <span className="detail-label">Availability</span>
          <strong className="detail-value">
            <span className="highlight-green">{station.availableChargers}</span> / {station.totalChargers} Free
          </strong>
        </div>

        <div className="detail-box">
          <span className="detail-label">Charger Type</span>
          <strong className="detail-value">{station.chargerType}</strong>
        </div>

        <div className="detail-box">
          <span className="detail-label">Power Output</span>
          <strong className="detail-value power-tag">⚡ {station.power}</strong>
        </div>

        <div className="detail-box">
          <span className="detail-label">Tariff</span>
          <strong className="detail-value">{station.price}</strong>
        </div>
      </div>

      {/* Visual Capacity Meter */}
      <div className="capacity-bar-container">
        <div className="capacity-labels">
          <small>Slot Usage</small>
          <small>{occupancyPercentage}% Occupied</small>
        </div>
        <div className="capacity-track">
          <div 
            className={`capacity-fill ${occupancyPercentage > 80 ? 'fill-high' : ''}`}
            style={{ width: `${occupancyPercentage}%` }}
          ></div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="station-card-footer">
        <button 
          className={`btn-action ${isAvailable ? 'btn-primary' : 'btn-disabled'}`}
          onClick={() => isAvailable && onBookClick(station)}
          disabled={!isAvailable}
        >
          {isAvailable ? 'Book Charger Slot' : 'Fully Occupied'}
        </button>
      </div>
    </div>
  );
}

export default StationCard;
