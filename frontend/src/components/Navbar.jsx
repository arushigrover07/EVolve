import React, { useState } from 'react';

function Navbar({ onFindChargerClick, onLoginClick, currentUser, onLogout }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNavClick = (id) => (e) => {
    const element = document.getElementById(id);
    if (element) {
      e.preventDefault();
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

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
          <a href="#stations" className="nav-link" onClick={handleNavClick('stations')}>Stations</a>
          <a href="#network" className="nav-link" onClick={handleNavClick('network')}>Network Status</a>
          <a href="#bookings" className="nav-link" onClick={handleNavClick('bookings')}>Bookings</a>
          {currentUser ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="nav-user-chip" style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--primary)', background: 'var(--bg-surface)', padding: '4px 10px', borderRadius: 'var(--radius-full)', border: '1px solid var(--border-color)' }}>
                👤 {currentUser.name}
              </span>
              <button 
                onClick={onLogout} 
                className="nav-link nav-link-muted" 
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                Logout
              </button>
            </div>
          ) : (
            <a 
              href="#login" 
              className="nav-link nav-link-muted"
              onClick={(e) => { e.preventDefault(); if (onLoginClick) onLoginClick(); }}
            >
              Login
            </a>
          )}
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
          <a href="#stations" onClick={(e) => { setMobileMenuOpen(false); handleNavClick('stations')(e); }}>Stations</a>
          <a href="#network" onClick={(e) => { setMobileMenuOpen(false); handleNavClick('network')(e); }}>Network Status</a>
          <a href="#bookings" onClick={(e) => { setMobileMenuOpen(false); handleNavClick('bookings')(e); }}>Bookings</a>
          {currentUser ? (
            <a href="#logout" onClick={(e) => { e.preventDefault(); setMobileMenuOpen(false); if (onLogout) onLogout(); }}>
              Logout ({currentUser.name})
            </a>
          ) : (
            <a href="#login" onClick={(e) => { e.preventDefault(); setMobileMenuOpen(false); if (onLoginClick) onLoginClick(); }}>
              Login
            </a>
          )}
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
