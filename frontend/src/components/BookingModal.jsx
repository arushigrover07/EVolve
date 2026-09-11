import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';

function BookingModal({ station, onClose, onBookingSuccess }) {
  const [chargersList, setChargersList] = useState(
    station && station.chargers && station.chargers.length > 0 ? station.chargers : []
  );
  const [loadingChargers, setLoadingChargers] = useState(chargersList.length === 0);

  useEffect(() => {
    let isMounted = true;
    async function fetchModalChargers() {
      if (!station || !station.id) return;
      try {
        setLoadingChargers(true);
        const res = await fetch(`${API_BASE_URL}/api/chargers?station_id=${station.id}`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted && Array.isArray(data) && data.length > 0) {
            setChargersList(data);
          }
        }
      } catch (err) {
        // Fallback gracefully
      } finally {
        if (isMounted) {
          setLoadingChargers(false);
        }
      }
    }

    fetchModalChargers();
    return () => { isMounted = false; };
  }, [station?.id]);

  const availableChargers = chargersList.filter((c) => c.status === 'AVAILABLE');

  const [selectedChargerId, setSelectedChargerId] = useState(null);

  useEffect(() => {
    if (availableChargers.length > 0) {
      setSelectedChargerId(availableChargers[0].id);
    } else if (chargersList.length > 0) {
      setSelectedChargerId(chargersList[0].id);
    } else {
      setSelectedChargerId(1);
    }
  }, [chargersList]);

  const [duration, setDuration] = useState(45); // minutes

  const [step, setStep] = useState('BOOKING'); // 'BOOKING' | 'BOOKED' | 'CHARGING' | 'COMPLETED'
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const [createdBooking, setCreatedBooking] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [energyInput, setEnergyInput] = useState(25);
  const [completedSession, setCompletedSession] = useState(null);

  if (!station) return null;

  const estimatedCost = Math.round((duration / 60) * 45 * 18);

  // 1. Confirm Booking
  const handleConfirmBooking = async (e) => {
    e.preventDefault();
    if (!selectedChargerId) {
      setError('Please select a charger unit.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const now = new Date();
      const startTime = now.toISOString();
      const endTime = new Date(now.getTime() + duration * 60 * 1000).toISOString();

      const response = await fetch(`${API_BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 1, // Demo user ID
          charger_id: Number(selectedChargerId),
          start_time: startTime,
          end_time: endTime,
          status: 'BOOKED'
        })
      });

      const data = await response.json();

      if (response.status === 409) {
        throw new Error(data.message || 'Charger is already booked for the selected time slot.');
      } else if (!response.ok) {
        throw new Error(data.message || 'Booking does not exist or failed to create.');
      }

      setCreatedBooking(data);
      setStep('BOOKED');
      if (onBookingSuccess) {
        onBookingSuccess(data);
      }
    } catch (err) {
      setError(err.message || 'An error occurred while creating booking');
    } finally {
      setSubmitting(false);
    }
  };

  // 2. Start Charging Session
  const handleStartSession = async () => {
    if (!createdBooking || !createdBooking.id) {
      setError('Booking does not exist. Cannot start session.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const response = await fetch(`${API_BASE_URL}/api/sessions/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: createdBooking.id
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Session cannot be started.');
      }

      setActiveSession(data);
      setStep('CHARGING');
      if (onBookingSuccess) {
        onBookingSuccess(data);
      }
    } catch (err) {
      setError(err.message || 'Session cannot be started');
    } finally {
      setSubmitting(false);
    }
  };

  // 3. Complete Charging Session & Calculate Bill
  const handleCompleteSession = async (e) => {
    e.preventDefault();
    const energyNum = Number(energyInput);

    if (energyInput === '' || isNaN(energyNum) || energyNum < 0) {
      setError('Invalid energy value entered. Please enter a valid non-negative number.');
      return;
    }

    if (!activeSession || !activeSession.id) {
      setError('Session cannot be completed because active session is missing.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const response = await fetch(`${API_BASE_URL}/api/sessions/${activeSession.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          energy_used_kwh: energyNum
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Session cannot be completed.');
      }

      setCompletedSession(data);
      setStep('COMPLETED');
      if (onBookingSuccess) {
        onBookingSuccess(data);
      }
    } catch (err) {
      setError(err.message || 'Session cannot be completed');
    } finally {
      setSubmitting(false);
    }
  };

  const calculatedBill = Number((Number(energyInput || 0) * 12).toFixed(2));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Close Button */}
        <button className="modal-close" onClick={onClose}>✕</button>

        {/* STEP 1: BOOKING FORM */}
        {step === 'BOOKING' && (
          <div>
            <div className="modal-header">
              <span className="badge-tech">⚡ EVolve Reserve</span>
              <h2>Book Charging Slot</h2>
              <p className="modal-subtitle">{station.name} — {station.location}</p>
            </div>

            {error && (
              <div style={{
                padding: '0.75rem 1rem',
                marginBottom: '1rem',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid #ef4444',
                borderRadius: '8px',
                color: '#f87171',
                fontSize: '0.9rem'
              }}>
                ⚠️ {error}
              </div>
            )}

            <form onSubmit={handleConfirmBooking} className="booking-form">
              <div className="form-group">
                <label className="form-label">Select Charger Unit</label>
                <div className="slot-grid">
                  {chargersList.length > 0 ? (
                    chargersList.map((charger, index) => {
                      const isFree = charger.status === 'AVAILABLE';
                      const isSelected = Number(selectedChargerId) === Number(charger.id);
                      return (
                        <button
                          key={charger.id}
                          type="button"
                          className={`slot-option ${isSelected ? 'selected' : ''} ${!isFree ? 'disabled' : ''}`}
                          onClick={() => isFree && setSelectedChargerId(charger.id)}
                          disabled={!isFree}
                        >
                          <span>Plug #{index + 1} ({charger.charger_type || 'Standard'})</span>
                          <small>{isFree ? 'Available' : charger.status}</small>
                        </button>
                      );
                    })
                  ) : (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      Defaulting to Demo Plug #1
                    </div>
                  )}
                </div>
              </div>

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

              <div className="booking-summary-card">
                <div className="summary-row">
                  <span>Power Rate:</span>
                  <strong>{station.power || '7.4 kW - 150 kW'}</strong>
                </div>
                <div className="summary-row">
                  <span>Selected Charger Unit:</span>
                  <strong>Charger #{selectedChargerId}</strong>
                </div>
                <div className="summary-row highlight">
                  <span>Est. Total Cost:</span>
                  <strong className="price-tag">₹{estimatedCost}</strong>
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-outline" onClick={onClose} disabled={submitting}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Processing Reservation...' : 'Confirm Reservation'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* STEP 2: BOOKING CONFIRMED */}
        {step === 'BOOKED' && createdBooking && (
          <div className="booking-success-state">
            <div className="success-icon">✅</div>
            <h2>Reservation Confirmed!</h2>
            <p>
              Your slot at <strong>{station.name}</strong> (Charger #{createdBooking.charger_id}) has been reserved for {duration} minutes.
            </p>

            {error && (
              <div style={{
                padding: '0.75rem 1rem',
                margin: '1rem 0',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid #ef4444',
                borderRadius: '8px',
                color: '#f87171',
                fontSize: '0.9rem'
              }}>
                ⚠️ {error}
              </div>
            )}

            <div className="ticket-box">
              <span>Booking ID:</span>
              <code>#{createdBooking.id}</code>
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button className="btn-primary btn-full" onClick={handleStartSession} disabled={submitting}>
                {submitting ? 'Starting Session...' : '⚡ Start Charging Session'}
              </button>
              <button className="btn-outline btn-full" onClick={onClose} disabled={submitting}>
                Back to Dashboard
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: ACTIVE CHARGING SESSION */}
        {step === 'CHARGING' && activeSession && (
          <div>
            <div className="modal-header">
              <span className="badge-tech">⚡ Active Charging Session</span>
              <h2>Charging in Progress...</h2>
              <p className="modal-subtitle">Session #{activeSession.id} — {station.name}</p>
            </div>

            {error && (
              <div style={{
                padding: '0.75rem 1rem',
                marginBottom: '1rem',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid #ef4444',
                borderRadius: '8px',
                color: '#f87171',
                fontSize: '0.9rem'
              }}>
                ⚠️ {error}
              </div>
            )}

            <form onSubmit={handleCompleteSession} className="booking-form">
              <div className="form-group">
                <label className="form-label">Energy Consumed (kWh)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={energyInput}
                  onChange={(e) => {
                    setEnergyInput(e.target.value);
                    setError(null);
                  }}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '1rem'
                  }}
                  placeholder="Enter energy in kWh (e.g. 25)"
                  required
                />
              </div>

              {/* Billing Breakdown */}
              <div className="booking-summary-card">
                <div className="summary-row">
                  <span>Energy Used:</span>
                  <strong>{energyInput || 0} kWh</strong>
                </div>
                <div className="summary-row">
                  <span>Rate:</span>
                  <strong>₹12 / kWh</strong>
                </div>
                <div className="summary-row highlight">
                  <span>Total Amount:</span>
                  <strong className="price-tag">₹{calculatedBill}</strong>
                </div>
              </div>

              <div className="modal-actions">
                <button type="submit" className="btn-primary btn-full" disabled={submitting}>
                  {submitting ? 'Completing Session...' : `Complete Session & Pay ₹${calculatedBill}`}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* STEP 4: CHARGING COMPLETED CONFIRMATION */}
        {step === 'COMPLETED' && completedSession && (
          <div className="booking-success-state">
            <div className="success-icon">⚡</div>
            <h2>Charging Completed!</h2>
            <p>Your session at <strong>{station.name}</strong> has successfully finished.</p>

            <div className="ticket-box" style={{ flexDirection: 'column', gap: '0.5rem', textAlign: 'left' }}>
              <div className="summary-row">
                <span>Session ID:</span>
                <code>#{completedSession.session?.id || activeSession?.id}</code>
              </div>
              <div className="summary-row">
                <span>Energy Used:</span>
                <strong>{completedSession.energy_used_kwh} kWh</strong>
              </div>
              <div className="summary-row">
                <span>Rate:</span>
                <strong>₹{completedSession.rate_per_kwh || 12}/kWh</strong>
              </div>
              <div className="summary-row highlight" style={{ marginTop: '0.5rem' }}>
                <span>Total Amount:</span>
                <strong className="price-tag" style={{ fontSize: '1.25rem' }}>₹{completedSession.amount}</strong>
              </div>
            </div>

            <button className="btn-primary btn-full" style={{ marginTop: '1.5rem' }} onClick={onClose}>
              Back to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default BookingModal;
