import React, { useState } from 'react';

function LoginModal({ isOpen, onClose, onLoginSuccess }) {
  const [email, setEmail] = useState('operator@evolve.cloud');
  const [password, setPassword] = useState('••••••••');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitting(true);

    setTimeout(() => {
      setSubmitting(false);
      setSuccessMsg('Successfully authenticated as Operator (User ID #1)');
      setTimeout(() => {
        if (onLoginSuccess) {
          onLoginSuccess({ id: 1, name: 'Demo Operator', email });
        }
        onClose();
        setSuccessMsg(null);
      }, 1000);
    }, 600);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container login-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
        <div className="modal-header">
          <div>
            <span className="modal-eyebrow">PORTAL ACCESS</span>
            <h2 className="modal-title">Operator Login</h2>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">✕</button>
        </div>

        <div className="modal-body">
          <div className="system-notice-box" style={{ marginBottom: '20px' }}>
            <span className="notice-icon">⚡</span>
            <div>
              <strong>Demo Environment Active</strong>
              <p style={{ fontSize: '0.82rem', margin: '2px 0 0 0', color: 'var(--text-muted)' }}>
                Authenticated actions manage slot reservations under Operator User ID #1.
              </p>
            </div>
          </div>

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
                  placeholder="operator@evolve.cloud"
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
                  placeholder="••••••••"
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
                  {submitting ? 'Signing In...' : 'Sign In as Operator'}
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
