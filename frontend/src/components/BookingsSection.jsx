import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';

function BookingsSection({ onBookNewClick }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function fetchBookings() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`${API_BASE_URL}/api/bookings`);
        if (!response.ok) {
          throw new Error(`Failed to fetch bookings (HTTP ${response.status})`);
        }
        const data = await response.json();
        if (isMounted && Array.isArray(data)) {
          setBookings(data);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Unable to connect to backend server');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchBookings();
    return () => { isMounted = false; };
  }, []);

  const formatDate = (isoString) => {
    if (!isoString) return 'N/A';
    try {
      const date = new Date(isoString);
      return date.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoString;
    }
  };

  return (
    <section id="bookings" className="bookings-section">
      <div className="section-container">
        {/* Section Header */}
        <div className="section-header">
          <div>
            <span className="section-eyebrow">SLOT RESERVATIONS</span>
            <h2 className="section-title">My Bookings & Reservations</h2>
          </div>
          <p className="section-description">
            View active slot reservations and historical charging session records.
          </p>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="stations-loading">
            <div className="spinner"></div>
            <p>Loading bookings from EVolve Cloud...</p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="stations-error">
            <span className="error-icon">⚠️</span>
            <h3>Unable to Load Bookings</h3>
            <p>{error}</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && bookings.length === 0 && (
          <div className="stations-empty">
            <span className="empty-icon">📅</span>
            <h3>No Bookings Found</h3>
            <p>You have not made any slot reservations yet.</p>
            {onBookNewClick && (
              <button className="btn-primary" onClick={onBookNewClick} style={{ marginTop: '16px' }}>
                Find a Charger to Reserve
              </button>
            )}
          </div>
        )}

        {/* Bookings List / Grid */}
        {!loading && !error && bookings.length > 0 && (
          <div className="bookings-grid">
            {bookings.map((booking) => (
              <div key={booking.id} className="booking-card">
                <div className="booking-card-header">
                  <div>
                    <span className="booking-id-tag">Booking #{booking.id}</span>
                    <h3 className="booking-station-name">{booking.station_name || 'EVolve Station'}</h3>
                    <p className="booking-station-location">📍 {booking.station_location || 'Location details unavailable'}</p>
                  </div>
                  <span className={`status-badge ${booking.status === 'BOOKED' ? 'badge-available' : 'badge-occupied'}`}>
                    <span className="badge-dot"></span>
                    {booking.status}
                  </span>
                </div>

                <div className="booking-card-details">
                  <div className="detail-item">
                    <span className="detail-label">Charger Info</span>
                    <span className="detail-value">
                      {booking.charger_type || 'Standard'} ({booking.power_kw ? `${booking.power_kw} kW` : 'Fast Charging'})
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Reserved Slot Start</span>
                    <span className="detail-value">{formatDate(booking.start_time)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Reserved Slot End</span>
                    <span className="detail-value">{formatDate(booking.end_time)}</span>
                  </div>
                </div>

                <div className="booking-card-footer">
                  <span className="booking-user-chip">Demo User #1</span>
                  {onBookNewClick && (
                    <button className="btn-secondary" onClick={onBookNewClick}>
                      Book Another Slot
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default BookingsSection;
