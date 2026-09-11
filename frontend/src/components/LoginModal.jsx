import React, { useState } from 'react';
import { API_BASE_URL } from '../config';

function LoginModal({ isOpen, onClose, onLoginSuccess }) {
  const [email, setEmail] = useState('demo@evolve.com');
  const [password, setPassword] = useState('demo123');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Authentication failed. Please check credentials.');
      }

      setSuccessMsg(`Authenticated as ${data.user.name} (Role: ${data.user.role || 'User'})`);
      
      setTimeout(() => {
        if (onLoginSuccess) {
          onLoginSuccess(data.user);
        }
        onClose();
        setSuccessMsg(null);
      }, 1000);
    } catch (err) {
      setErrorMsg(err.message || 'Unable to connect to login authentication service');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container login-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
        <div className="modal-header">
          <div>
            <span className="modal-eyebrow">PORTAL ACCESS</span>
            <h2 className="modal-title">EVolve Login</h2>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">✕</button>
        </div>

        <div className="modal-body">
          <div className="system-notice-box" style={{ marginBottom: '20px' }}>
            <span className="notice-icon">⚡</span>
            <div>
              <strong>PostgreSQL Database Authentication</strong>
              <p style={{ fontSize: '0.82rem', margin: '2px 0 0 0', color: 'var(--text-muted)' }}>
                Validates credentials against Neon PostgreSQL database records.
              </p>
            </div>
          </div>

          {errorMsg && (
            <div className="stations-error" style={{ marginBottom: '16px', padding: '12px 16px' }}>
              <p style={{ margin: 0, color: 'var(--status-danger-text)', fontSize: '0.88rem' }}>⚠️ {errorMsg}</p>
            </div>
          )}

          {successMsg ? (
            <div className="booking-success-state" style={{ padding: '20px 0', textAlign: 'center' }}>
              <span style={{ fontSize: '2.5rem' }}>✅</span>
              <h3 style={{ marginTop: '12px', color: 'var(--status-success-text)' }}>{successMsg}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Session active. Closing dialog...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-dark)' }}>
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="demo@evolve.com"
                  required
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-surface)',
                    fontSize: '0.95rem'
                  }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-dark)' }}>
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="demo123"
                  required
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-surface)',
                    fontSize: '0.95rem'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Authenticating...' : 'Sign In'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default LoginModal;
