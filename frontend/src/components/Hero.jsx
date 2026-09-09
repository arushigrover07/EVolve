import React from 'react';

function Hero({ onExploreClick }) {
  return (
    <section className="hero-section">
      <div className="hero-container">
        {/* Left Column: Text & CTAs */}
        <div className="hero-content">
          <div className="hero-tag">
            <span className="pulse-dot"></span>
            <span>REAL-TIME CLOUD EV NETWORK</span>
          </div>

          <h1 className="hero-title">
            Charge Smarter.<br />
            <span className="highlight-text">Travel Further.</span>
          </h1>

          <p className="hero-description">
            Locate available EV charging stations in real-time, reserve your high-speed charging slot in advance, and manage your electric journey effortlessly across our cloud management platform.
          </p>

          <div className="hero-actions">
            <button className="btn-primary btn-lg" onClick={onExploreClick}>
              <span>Find Charging Stations</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>

            <a href="#network" className="btn-outline btn-lg">
              <span>View Network Status</span>
            </a>
          </div>

          {/* Quick Metrics Bar */}
          <div className="hero-features-strip">
            <div className="feature-item">
              <span className="feature-icon">⚡</span>
              <span>Ultra-Fast DC Charging</span>
            </div>
            <div className="feature-item">
              <span className="feature-icon">📅</span>
              <span>Instant Slot Booking</span>
            </div>
            <div className="feature-item">
              <span className="feature-icon">☁️</span>
              <span>Cloud Monitored</span>
            </div>
          </div>
        </div>

        {/* Right Column: Visual EV Charger Graphic & Telemetry Card */}
        <div className="hero-visual">
          <div className="visual-card">
            {/* Header */}
            <div className="visual-header">
              <div className="station-info">
                <span className="station-dot online"></span>
                <div>
                  <strong>EVolve Central Hub</strong>
                  <p>Vellore Main Campus • Charger #02</p>
                </div>
              </div>
              <span className="badge-tech">150 kW DC</span>
            </div>

            {/* Live Charging Telemetry */}
            <div className="telemetry-box">
              <div className="telemetry-top">
                <span className="telemetry-label">Active Session Progress</span>
                <span className="telemetry-value">84%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill animated-glow" style={{ width: '84%' }}></div>
              </div>
              <div className="telemetry-details">
                <div>
                  <small>Energy Delivered</small>
                  <strong>42.8 kWh</strong>
                </div>
                <div>
                  <small>Power Rate</small>
                  <strong>142 kW</strong>
                </div>
                <div>
                  <small>Est. Time Left</small>
                  <strong>8 mins</strong>
                </div>
              </div>
            </div>

            {/* Simulated Energy Flow Graphic */}
            <div className="energy-flow-container">
              <div className="energy-line">
                <span className="pulse-particle"></span>
                <span className="pulse-particle p2"></span>
              </div>
              <div className="flow-status">
                <span className="flow-icon">⚡</span>
                <span>High-Speed Power Delivery Active</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default Hero;
