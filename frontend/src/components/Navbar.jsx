import React, { useState } from 'react';

function Navbar({ onFindChargerClick }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="navbar-container">
      <div className="navbar-inner">
        {/* Brand Logo */}
        <div className="navbar-brand">
          <span className="brand-icon">⚡</span>
          <span className="brand-name">EVolve</span>
          <span className="brand-badge">Cloud</span>
        </div>

        {/* Desktop Navigation Links */}
        <nav className="navbar-links">
          <a href="#stations" className="nav-link">Stations</a>
          <a href="#network" className="nav-link">Network Status</a>
          <a href="#bookings" className="nav-link">Bookings</a>
          <a href="#login" className="nav-link nav-link-muted">Login</a>
        </nav>

        {/* Action Button */}
        <div className="navbar-actions">
          <button className="btn-primary" onClick={onFindChargerClick}>
            <span>Find a Charger</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>

          {/* Mobile Hamburger Toggle */}
          <button 
            className="mobile-toggle" 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <span className={`hamburger ${mobileMenuOpen ? 'open' : ''}`}></span>
          </button>
        </div>
      </div>

      {/* Mobile Menu Drawer */}
      {mobileMenuOpen && (
        <div className="mobile-menu">
          <a href="#stations" onClick={() => setMobileMenuOpen(false)}>Stations</a>
          <a href="#network" onClick={() => setMobileMenuOpen(false)}>Network Status</a>
          <a href="#bookings" onClick={() => setMobileMenuOpen(false)}>Bookings</a>
          <a href="#login" onClick={() => setMobileMenuOpen(false)}>Login</a>
          <button 
            className="btn-primary btn-full" 
            onClick={() => { setMobileMenuOpen(false); onFindChargerClick(); }}
          >
            Find a Charger
          </button>
        </div>
      )}
    </header>
  );
}

export default Navbar;
