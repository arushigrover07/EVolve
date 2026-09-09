import React, { useState } from 'react';
import StationCard from './StationCard';

function StationsSection({ onBookClick }) {
  // Realistic sample EV charging station datasets
  const [stations] = useState([
    {
      id: 1,
      name: "EVolve Central Hub",
      location: "Vellore Main Campus",
      distance: "1.2 km away",
      availableChargers: 4,
      totalChargers: 6,
      chargerType: "CCS2 Dual Fast DC",
      power: "150 kW DC",
      price: "₹18/kWh",
      status: "Available"
    },
    {
      id: 2,
      name: "Green Charge Point",
      location: "Chennai Tech Corridor",
      distance: "3.5 km away",
      availableChargers: 2,
      totalChargers: 5,
      chargerType: "Type 2 AC",
      power: "22 kW AC",
      price: "₹12/kWh",
      status: "Available"
    },
    {
      id: 3,
      name: "EcoCharge Express",
      location: "Bangalore Outer Ring Rd",
      distance: "5.8 km away",
      availableChargers: 5,
      totalChargers: 8,
      chargerType: "CCS2 / CHAdeMO",
      power: "60 kW DC",
      price: "₹15/kWh",
      status: "Available"
    },
    {
      id: 4,
      name: "TechPark Rapid Station",
      location: "Coimbatore IT Park",
      distance: "8.1 km away",
      availableChargers: 0,
      totalChargers: 4,
      chargerType: "CCS2 Ultra-Fast",
      power: "240 kW DC",
      price: "₹22/kWh",
      status: "Occupied"
    }
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');

  // Filter logic
  const filteredStations = stations.filter((station) => {
    const matchesSearch =
      station.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      station.location.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (activeFilter === 'AVAILABLE') return station.availableChargers > 0;
    if (activeFilter === 'DC_FAST') return station.power.includes('DC');
    if (activeFilter === 'AC') return station.power.includes('AC');

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
              placeholder="Search station name or location (e.g. Vellore, Chennai)..."
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
            <button
              className={`filter-btn ${activeFilter === 'DC_FAST' ? 'active' : ''}`}
              onClick={() => setActiveFilter('DC_FAST')}
            >
              DC Fast (50kW+)
            </button>
            <button
              className={`filter-btn ${activeFilter === 'AC' ? 'active' : ''}`}
              onClick={() => setActiveFilter('AC')}
            >
              Standard AC
            </button>
          </div>
        </div>

        {/* Stations Grid */}
        {filteredStations.length > 0 ? (
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
        )}
      </div>
    </section>
  );
}

export default StationsSection;
