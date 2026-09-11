import React from 'react';

function StationCard({ station, onBookClick }) {
  const isAvailable = station.status === 'ACTIVE' || station.status === 'Available';

  const totalChargers = station.total_chargers ?? station.totalChargers ?? 1;
  const availableChargers = station.available_chargers ?? station.availableChargers ?? (isAvailable ? 1 : 0);
  const chargingChargers = station.charging_chargers ?? 0;

  const hasCoords = station.latitude != null && station.longitude != null;
  const coordsText = hasCoords
    ? `${Number(station.latitude).toFixed(4)}°, ${Number(station.longitude).toFixed(4)}°`
    : (station.distance || null);

  const chargerType = station.chargerType || "CCS2 / Standard AC";
  const power = station.power || "7.4 kW - 150 kW";

  return (
    <div className={`station-card ${!isAvailable ? 'station-full' : ''}`}>
      {/* Header */}
      <div className="station-card-header">
        <div className="station-title-group">
          <h3 className="station-name">{station.name}</h3>
          <p className="station-location">
            <span className="location-icon">📍</span> {station.location}
            {coordsText && (
              <> • <span className="distance-badge">{coordsText}</span></>
            )}
          </p>
        </div>
        <span className={`status-badge ${isAvailable ? 'badge-available' : 'badge-occupied'}`}>
          <span className="badge-dot"></span>
          {isAvailable ? 'Active' : 'Inactive'}
        </span>
      </div>

      {/* Details Grid */}
      <div className="station-details-grid">
        <div className="detail-box">
          <span className="detail-label">Real Availability</span>
          <strong className="detail-value">
            <span>
              <span className="highlight-green">{availableChargers}</span> / {totalChargers} Free
            </span>
          </strong>
        </div>

        <div className="detail-box">
          <span className="detail-label">Charger Summary</span>
          <strong className="detail-value">
            <span>
              Available: {availableChargers} | Charging: {chargingChargers} | Total: {totalChargers}
            </span>
          </strong>
        </div>

        <div className="detail-box">
          <span className="detail-label">Charger Type</span>
          <strong className="detail-value">{chargerType}</strong>
        </div>

        <div className="detail-box">
          <span className="detail-label">Power Output</span>
          <strong className="detail-value power-tag">⚡ {power}</strong>
        </div>
      </div>

      {/* Visual Capacity Meter */}
      <div className="capacity-bar-container">
        <div className="capacity-labels">
          <small>Charger Usage</small>
          <small>
            {`${availableChargers} of ${totalChargers} units available`}
          </small>
        </div>
        <div className="capacity-track">
          <div 
            className={`capacity-fill ${availableChargers === 0 && totalChargers > 0 ? 'fill-high' : ''}`}
            style={{
              width: totalChargers > 0 ? `${(availableChargers / totalChargers) * 100}%` : (isAvailable ? '100%' : '0%')
            }}
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
          {isAvailable ? 'Book Charger Slot' : 'Unavailable'}
        </button>
      </div>
    </div>
  );
}

export default StationCard;
