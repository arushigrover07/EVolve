import React, { useState } from 'react';

function BookingModal({ station, onClose }) {
  const [selectedSlot, setSelectedSlot] = useState(1);
  const [duration, setDuration] = useState(45); // minutes
  const [isSubmitted, setIsSubmitted] = useState(false);

  if (!station) return null;

  // Simple cost calculation
  const estimatedCost = Math.round((duration / 60) * 45 * 18);

  const handleConfirm = (e) => {
    e.preventDefault();
    setIsSubmitted(true);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Close Button */}
        <button className="modal-close" onClick={onClose}>✕</button>

        {!isSubmitted ? (
          <div>
            <div className="modal-header">
              <span className="badge-tech">⚡ EVolve Reserve</span>
              <h2>Book Charging Slot</h2>
              <p className="modal-subtitle">{station.name} — {station.location}</p>
            </div>

            <form onSubmit={handleConfirm} className="booking-form">
              {/* Charger Slot Selection */}
              <div className="form-group">
                <label className="form-label">Select Charger Unit</label>
                <div className="slot-grid">
                  {Array.from({ length: station.totalChargers }).map((_, index) => {
                    const slotNum = index + 1;
                    const isFree = slotNum <= station.availableChargers;
                    return (
                      <button
                        key={slotNum}
                        type="button"
                        className={`slot-option ${selectedSlot === slotNum ? 'selected' : ''} ${!isFree ? 'disabled' : ''}`}
                        onClick={() => isFree && setSelectedSlot(slotNum)}
                        disabled={!isFree}
                      >
                        <span>Plug #{slotNum}</span>
                        <small>{isFree ? 'Available' : 'Busy'}</small>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Duration Selection */}
              <div className="form-group">
                <label className="form-label">Charging Duration</label>
                <div className="duration-options">
                  {[30, 45, 60, 90].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      className={`duration-chip ${duration === mins ? 'active' : ''}`}
                      onClick={() => setDuration(mins)}
                    >
                      {mins} Mins
                    </button>
                  ))}
                </div>
              </div>

              {/* Price & Summary Box */}
              <div className="booking-summary-card">
                <div className="summary-row">
                  <span>Power Rate:</span>
                  <strong>{station.power}</strong>
                </div>
                <div className="summary-row">
                  <span>Selected Unit:</span>
                  <strong>Charger Plug #{selectedSlot}</strong>
                </div>
                <div className="summary-row highlight">
                  <span>Est. Total Cost:</span>
                  <strong className="price-tag">₹{estimatedCost}</strong>
                </div>
              </div>

              {/* Actions */}
              <div className="modal-actions">
                <button type="button" className="btn-outline" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Confirm Reservation
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* Confirmation State */
          <div className="booking-success-state">
            <div className="success-icon">✅</div>
            <h2>Reservation Confirmed!</h2>
            <p>
              Your slot at <strong>{station.name}</strong> (Plug #{selectedSlot}) has been reserved for {duration} minutes.
            </p>
            <div className="ticket-box">
              <span>Reservation Ref:</span>
              <code>EV-CONF-{Math.floor(100000 + Math.random() * 900000)}</code>
            </div>
            <button className="btn-primary btn-full" onClick={onClose}>
              Back to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default BookingModal;
