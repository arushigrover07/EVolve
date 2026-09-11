import React, { useState, useEffect } from 'react';
import StationCard from './StationCard';
import { API_BASE_URL } from '../config';

function StationsSection({ onBookClick }) {
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');

  useEffect(() => {
    async function fetchStations() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`${API_BASE_URL}/api/stations`);
        if (!response.ok) {
          throw new Error(`Failed to fetch stations (HTTP ${response.status})`);
        }
        const data = await response.json();
        setStations(data);
      } catch (err) {
        setError(err.message || 'Unable to connect to backend server');
      } finally {
        setLoading(false);
      }
    }

    fetchStations();
  }, []);

  // Filter logic
  const filteredStations = stations.filter((station) => {
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch =
      (station.name && station.name.toLowerCase().includes(searchLower)) ||
      (station.location && station.location.toLowerCase().includes(searchLower));

    if (!matchesSearch) return false;

    if (activeFilter === 'AVAILABLE') {
      return station.status === 'ACTIVE' || station.status === 'Available';
    }

    return true;
  });

  return (
    <section id="stations" className="stations-section">
      <div className="section-container">
        {/* Section Header */}
        <div className="section-header center-text">
          <span className="section-eyebrow">CHARGING STATIONS</span>
          <h2 className="section-title">Nearby Charging Stations</h2>
          <p className="section-description">
            Find high-speed EV chargers near your location with live availability and slot booking.
          </p>
        </div>

        {/* Filter & Search Bar */}
        <div className="filter-bar">
          {/* Search Box */}
          <div className="search-input-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Search station name or location (e.g. Vellore, Maharashtra)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="clear-btn" onClick={() => setSearchQuery('')}>✕</button>
            )}
          </div>

          {/* Filter Tabs */}
          <div className="filter-tabs">
            <button
              className={`filter-btn ${activeFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => setActiveFilter('ALL')}
            >
              All Hubs ({stations.length})
            </button>
            <button
              className={`filter-btn ${activeFilter === 'AVAILABLE' ? 'active' : ''}`}
              onClick={() => setActiveFilter('AVAILABLE')}
            >
              Available Now
            </button>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="empty-state">
            <span className="empty-icon">⚡</span>
            <h3>Loading Charging Stations...</h3>
            <p>Fetching real station data from backend server...</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="empty-state">
            <span className="empty-icon">⚠️</span>
            <h3>Unable to Connect to API</h3>
            <p>{error}</p>
          </div>
        )}

        {/* Stations Grid */}
        {!loading && !error && (
          filteredStations.length > 0 ? (
            <div className="stations-grid">
              {filteredStations.map((station) => (
                <StationCard
                  key={station.id}
                  station={station}
                  onBookClick={onBookClick}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-icon">📍</span>
              <h3>No charging stations match your filter</h3>
              <p>Try searching for a different city or clearing your active filters.</p>
              <button
                className="btn-outline"
                onClick={() => { setSearchQuery(''); setActiveFilter('ALL'); }}
              >
                Reset Filters
              </button>
            </div>
          )
        )}
      </div>
    </section>
  );
}

export default StationsSection;

