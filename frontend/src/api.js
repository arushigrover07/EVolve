import { API_BASE_URL } from './config';

const TOKEN_KEY = 'evolve_verified_session_token';
const USER_KEY = 'evolve_current_user';

// In-memory fallback if localStorage is unavailable
let memoryToken = null;
let memoryUser = null;

export function getAuthToken() {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(TOKEN_KEY) || memoryToken;
    }
    return memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setAuthToken(token) {
  if (typeof token !== 'string' || !token) {
    clearAuthToken();
    return;
  }
  memoryToken = token;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, token);
    }
  } catch {
    // In-memory fallback retained
  }
}

export function clearAuthToken() {
  memoryToken = null;
  memoryUser = null;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  } catch {
    // Ignore
  }
}

export function getAuthUser() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : memoryUser;
    }
    return memoryUser;
  } catch {
    return memoryUser;
  }
}

export function setAuthUser(user) {
  memoryUser = user || null;
  try {
    if (typeof localStorage !== 'undefined') {
      if (user) {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(USER_KEY);
      }
    }
  } catch {
    // In-memory fallback retained
  }
}

export function isAuthenticated() {
  return Boolean(getAuthToken());
}

export function logout() {
  clearAuthToken();
}

/**
 * Checks whether the destination URL matches the configured backend API origin or current browser origin.
 * Prevents credentials from leaking to third-party or unrelated domains.
 */
export function isSafeApiOrigin(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('/') && !url.startsWith('//')) return true;

  try {
    const currentOrigin = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost';
    const targetUrl = new URL(url, currentOrigin);
    const apiUrl = new URL(API_BASE_URL || currentOrigin, currentOrigin);

    return targetUrl.origin === apiUrl.origin || targetUrl.origin === currentOrigin;
  } catch {
    return false;
  }
}

/**
 * Central API fetch wrapper.
 * Automatically attaches the verified session token as `Authorization: Bearer <token>`
 * for safe API origins. Never exposes tokens in error messages.
 */
export async function apiFetch(endpoint, options = {}) {
  const { headers = {}, skipAuth = false, ...restOptions } = options;

  let url = endpoint;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const base = API_BASE_URL || '';
    if (url.startsWith('/')) {
      url = `${base}${url}`;
    } else {
      url = `${base}/${url}`;
    }
  }

  const requestHeaders = new Headers(headers);

  // Set default JSON Content-Type if body is present and not set
  if (restOptions.body && !requestHeaders.has('Content-Type') && typeof restOptions.body === 'string') {
    requestHeaders.set('Content-Type', 'application/json');
  }

  // Attach verified token ONLY for safe origins and when not explicitly skipped
  if (!skipAuth && isSafeApiOrigin(url)) {
    const token = getAuthToken();
    if (token) {
      requestHeaders.set('Authorization', `Bearer ${token}`);
    }
  }

  try {
    const response = await fetch(url, {
      ...restOptions,
      headers: requestHeaders
    });

    // Handle token expiry / invalidation gracefully: clear state on 401 from protected routes
    if (response.status === 401 && !url.includes('/api/login') && !url.includes('/api/mfa/verify')) {
      clearAuthToken();
    }

    return response;
  } catch (err) {
    const cleanMsg = err && err.message
      ? err.message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
      : 'Network request failed';
    throw new Error(cleanMsg);
  }
}

// ==========================================
// STATIONS API
// ==========================================

export async function getStations() {
  const res = await apiFetch('/api/stations');
  if (!res.ok) throw new Error(`Failed to fetch stations (${res.status})`);
  return res.json();
}

export async function getNearbyStations(latitude, longitude) {
  const res = await apiFetch(`/api/stations/nearby?latitude=${latitude}&longitude=${longitude}`);
  if (!res.ok) throw new Error(`Failed to fetch nearby stations (${res.status})`);
  return res.json();
}

export async function updateStation(id, stationData) {
  const res = await apiFetch(`/api/stations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(stationData)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Failed to update station (${res.status})`);
  return data;
}

export async function deleteStation(id) {
  const res = await apiFetch(`/api/stations/${id}`, {
    method: 'DELETE'
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Failed to delete station (${res.status})`);
  return data;
}

// ==========================================
// CHARGERS API
// ==========================================

export async function getChargers(stationId) {
  const endpoint = stationId ? `/api/chargers?station_id=${stationId}` : '/api/chargers';
  const res = await apiFetch(endpoint);
  if (!res.ok) throw new Error(`Failed to fetch chargers (${res.status})`);
  return res.json();
}

export async function updateCharger(id, chargerData) {
  const res = await apiFetch(`/api/chargers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(chargerData)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Failed to update charger (${res.status})`);
  return data;
}

export async function deleteCharger(id) {
  const res = await apiFetch(`/api/chargers/${id}`, {
    method: 'DELETE'
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Failed to delete charger (${res.status})`);
  return data;
}

// ==========================================
// BOOKINGS API
// ==========================================

export async function getBookings() {
  const res = await apiFetch('/api/bookings');
  if (!res.ok) throw new Error(`Failed to fetch bookings (${res.status})`);
  return res.json();
}

export async function createBooking(bookingData) {
  const res = await apiFetch('/api/bookings', {
    method: 'POST',
    body: JSON.stringify(bookingData)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Failed to create booking (${res.status})`);
  return data;
}

export async function updateBooking(id, bookingData) {
  const res = await apiFetch(`/api/bookings/${id}`, {
    method: 'PUT',
    body: JSON.stringify(bookingData)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Failed to update booking (${res.status})`);
  return data;
}

export async function deleteBooking(id) {
  const res = await apiFetch(`/api/bookings/${id}`, {
    method: 'DELETE'
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Failed to delete booking (${res.status})`);
  return data;
}

// ==========================================
// CHARGING SESSIONS API
// ==========================================

export async function startSession(bookingId) {
  const res = await apiFetch('/api/sessions/start', {
    method: 'POST',
    body: JSON.stringify({ booking_id: bookingId })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Failed to start charging session (${res.status})`);
  return data;
}

export async function completeSession(id, energyUsedKwh) {
  const res = await apiFetch(`/api/sessions/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ energy_used_kwh: energyUsedKwh })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Failed to complete charging session (${res.status})`);
  return data;
}

export async function updateSession(id, sessionData) {
  const res = await apiFetch(`/api/sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(sessionData)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Failed to update session (${res.status})`);
  return data;
}

export async function deleteSession(id) {
  const res = await apiFetch(`/api/sessions/${id}`, {
    method: 'DELETE'
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Failed to delete session (${res.status})`);
  return data;
}

// ==========================================
// AUTHENTICATION & MFA API
// ==========================================

export async function loginUser(email, password) {
  const res = await apiFetch('/api/login', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || 'Authentication failed. Please check credentials.');
  }
  return data;
}

export async function verifyMfaCode(mfaToken, totpCode) {
  const res = await apiFetch('/api/mfa/verify', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({ mfa_token: mfaToken, totp_code: totpCode })
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || 'Invalid or expired TOTP code.');
  }
  return data;
}
