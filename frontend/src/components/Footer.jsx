import React from 'react';

function Footer() {
  return (
    <footer className="footer-container">
      <div className="section-container">
        <div className="footer-top">
          {/* Brand Info */}
          <div className="footer-brand-col">
            <div className="navbar-brand">
              <span className="brand-icon">⚡</span>
              <span className="brand-name">EVolve</span>
              <span className="brand-badge">Cloud</span>
            </div>
            <p className="footer-description">
              Real-time cloud-based EV charging management platform engineered for intelligent grid management and seamless slot reservation.
            </p>
            <div className="system-status-chip">
              <span className="status-dot-pulsing"></span>
              <span>All Systems Operational • Cloud Region: AWS ap-south-1</span>
            </div>
          </div>

          {/* Quick Links Column */}
          <div className="footer-links-col">
            <h4>Platform Navigation</h4>
            <ul>
              <li><a href="#stations">Find Charging Stations</a></li>
              <li><a href="#network">Live Network Status</a></li>
              <li><a href="#bookings">My Bookings</a></li>
              <li><a href="#login">Operator Login</a></li>
            </ul>
          </div>

          {/* Technology Stack / Viva Info Column */}
          <div className="footer-links-col">
            <h4>System Architecture</h4>
            <div className="tech-stack-pills">
              <span className="tech-pill">Frontend: React + Vite</span>
              <span className="tech-pill">Backend: Node.js + Express</span>
              <span className="tech-pill">Database: Neon PostgreSQL</span>
              <span className="tech-pill">Protocol: REST & WebSockets</span>
            </div>
          </div>
        </div>

        {/* Footer Bottom Bar */}
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} EVolve Charging Management Platform. Built for Cloud Infrastructure & Architecture Project.</p>
          <div className="footer-legal">
            <a href="#">Privacy Policy</a>
            <span>•</span>
            <a href="#">Terms of Service</a>
            <span>•</span>
            <a href="#">System Docs</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
