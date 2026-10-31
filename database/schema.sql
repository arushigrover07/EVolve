-- EVolve EV Charging Management Platform
-- Database Schema Definition

-- 1. Stations Table
CREATE TABLE IF NOT EXISTS stations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  location VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'ACTIVE',
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Chargers Table
CREATE TABLE IF NOT EXISTS chargers (
  id SERIAL PRIMARY KEY,
  station_id INT REFERENCES stations(id) ON DELETE CASCADE,
  charger_type VARCHAR(100) NOT NULL,
  power_kw NUMERIC(6, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'AVAILABLE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Bookings Table
CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  charger_id INT REFERENCES chargers(id) ON DELETE CASCADE,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  status VARCHAR(50) DEFAULT 'BOOKED',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Charging Sessions Table
CREATE TABLE IF NOT EXISTS charging_sessions (
  id SERIAL PRIMARY KEY,
  booking_id INT REFERENCES bookings(id) ON DELETE CASCADE,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  energy_used_kwh NUMERIC(8, 2) DEFAULT 0,
  amount NUMERIC(10, 2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Users Table
-- Registered operators and drivers with salted bcrypt password hashes (12 salt rounds) and optional TOTP MFA
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  totp_secret VARCHAR(64),
  mfa_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Migration Queries for User TOTP MFA (DA3 Q2b)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64),
ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE;

-- Migration Queries for OpenChargeMap (OCM) Data Integration
ALTER TABLE stations
ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7),
ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7),
ADD COLUMN IF NOT EXISTS ocm_id INT UNIQUE;

ALTER TABLE chargers
ADD COLUMN IF NOT EXISTS ocm_connection_id INT,
ADD COLUMN IF NOT EXISTS ocm_port_index INT DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS chargers_station_ocm_conn_idx
ON chargers (station_id, ocm_connection_id, ocm_port_index)
WHERE ocm_connection_id IS NOT NULL;
