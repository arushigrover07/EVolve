# EVolve ⚡
### Real-Time Cloud-Based EV Charging Management Platform

EVolve is a cloud-based electric vehicle charging management platform designed to support the management of charging stations, chargers, bookings, and charging sessions.

## 🌐 Live Demo

- **Frontend:** https://evolve-frontend-g9rs.onrender.com/
- **Backend Health Check:** https://evolve-qvy1.onrender.com/health

## ✨ Features

- EV charging station discovery and management
- Charger status monitoring
- Booking and charging-session management
- PostgreSQL database integration
- Secure authentication with multi-factor authentication (MFA)
- Role-based access control (RBAC)
- Protected operations and access validation
- Containerization and Docker image security hardening
- Cloud deployment for the frontend and backend

## 🛠️ Technology Stack

- **Frontend:** React, Vite, CSS
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL (Neon)
- **Deployment:** Render
- **Containerization:** Docker
- **Security:** MFA, role-based access control, password hashing, and Trivy vulnerability scanning

## 🏗️ Architecture

EVolve uses a frontend-backend architecture. The React frontend communicates with the Express backend through API endpoints, while PostgreSQL stores application data.

The application also incorporates authentication and authorization controls to protect restricted operations.

## 🔐 Security

Security measures implemented in the project include:

- Multi-factor authentication using TOTP
- Role-based access control for protected operations
- Password hashing using bcrypt
- Authentication and authorization checks
- Docker image hardening
- Vulnerability scanning using Trivy

## 🚀 Deployment

The frontend and backend are deployed separately on Render. The backend connects to a Neon PostgreSQL database.

- [Open EVolve](https://evolve-frontend-g9rs.onrender.com/)
- [Check Backend Health](https://evolve-qvy1.onrender.com/health)

---

**Project:** EVolve — Real-Time Cloud-Based EV Charging Management Platform
