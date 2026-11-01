# Q2(b) Evidence Index: MFA and RBAC Verification

This directory contains genuine evidence artifacts and terminal logs demonstrating Multi-Factor Authentication (MFA) and Role-Based Access Control (RBAC) verification for Digital Assignment 3 (DA3).

---

## Evidence & Screenshot Mapping

| Index | Artifact / Screenshot Filename | Description | Environment | Target Endpoint | Actual Result |
|:---:|:---|:---|:---:|:---|:---:|
| **01** | `01-mfa-login-prompt.png` | Operator login triggering MFA challenge modal | Live Render | `POST /api/login` | `HTTP 200` (`mfa_required: true`) |
| **02** | `02-mfa-authenticator-entry.png` | TOTP 6-digit entry interface with Google Authenticator | Live Render | Interactive Web UI | Client UI |
| **03** | `03-mfa-verify-success.png` | Successful TOTP verification & authenticated session token | Live Render | `POST /api/mfa/verify` | `HTTP 200` (`mfaVerified: true`) |
| **04** | `04-mfa-operator-dashboard.png` | Authenticated operator view with privileged controls | Live Render | Browser UI | Operator dashboard rendered |
| **05** | `05-rbac-401-terminal.png` / `.txt` | Unauthenticated station mutation attempt | Live Render | `PUT /api/stations/999999` | **`HTTP 401 Unauthorized`** (no Bearer token) |
| **06** | `06-rbac-auth-middleware.png` | VS Code source view of `requireAuth` middleware order | Codebase | `backend/app.js` & `backend/auth.js` | Short-circuit before route handler |
| **07** | `07-rbac-403-terminal.png` / `.txt` | Authenticated regular user attempting operator action | Live Render | `PUT /api/stations/999999` | **`HTTP 403 Forbidden`** (`role: 'user'`) |
| **08** | `08-rbac-role-middleware.png` | VS Code source view of `requireRole` check | Codebase | `backend/app.js` & `backend/auth.js` | Short-circuit before database query |
| **09** | `09-rbac-delete-401-terminal.png` / `.txt` | Unauthenticated station deletion attempt | **Isolated Local Mock** | `DELETE /api/stations/1` | **`HTTP 401 Unauthorized`** (Station 1 intact) |

---

## Environment Separation & Safety
1. **Live Render Production Backend (`https://evolve-qvy1.onrender.com`)**:
   - Used exclusively for safe read-only checks, login/MFA verification, and non-destructive PUT probes targeting synthetic non-existent station ID `999999`.
   - Never sent destructive `DELETE` requests to production.
2. **Isolated Local Mock Server (`http://127.0.0.1:5000`)**:
   - Used for destructive route verification (`DELETE /api/stations/1`).
   - Runs with a 100% in-memory mock database; zero connectivity to Neon PostgreSQL or Render.
   - Confirms that unauthenticated DELETE attempts are rejected by `requireAuth` with `HTTP 401 Unauthorized` without modifying any data.
