import React, { useState, useEffect } from 'react';
import { getBookings, deleteBooking } from '../api';

function BookingsSection({ currentUser, onBookNewClick }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const fetchBookingsList = async (isMounted = true) => {
    try {
      setLoading(true);
      setError(null);
      const data = await getBookings();
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
  };

  useEffect(() => {
    let isMounted = true;
    fetchBookingsList(isMounted);
    return () => { isMounted = false; };
  }, []);

  const handleCancelBooking = async (bookingId) => {
    setActionError(null);
    setCancellingId(bookingId);
    try {
      await deleteBooking(bookingId);
      // Remove cancelled booking from list
      setBookings((prev) => prev.filter((b) => b.id !== bookingId));
    } catch (err) {
      setActionError(err.message || 'Failed to cancel reservation');
    } finally {
      setCancellingId(null);
    }
  };

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
            View active slot reservations and manage charging sessions.
          </p>
        </div>

        {actionError && (
          <div className="stations-error" style={{ marginBottom: '16px', padding: '12px 16px' }}>
            <p style={{ margin: 0, color: 'var(--status-danger-text)', fontSize: '0.88rem' }}>⚠️ {actionError}</p>
          </div>
        )}

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

                <div className="booking-card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="booking-user-chip">
                    {currentUser && currentUser.id === booking.user_id
                      ? `👤 ${currentUser.name}`
                      : `User #${booking.user_id}`}
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {booking.status === 'BOOKED' && (
                      <button
                        className="btn-secondary"
                        style={{ color: 'var(--status-danger-text)', borderColor: 'var(--status-danger-text)' }}
                        onClick={() => handleCancelBooking(booking.id)}
                        disabled={cancellingId === booking.id}
                      >
                        {cancellingId === booking.id ? 'Cancelling...' : 'Cancel Slot'}
                      </button>
                    )}
                    {onBookNewClick && (
                      <button className="btn-secondary" onClick={onBookNewClick}>
                        Book Another
                      </button>
                    )}
                  </div>
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
