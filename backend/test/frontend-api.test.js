const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");

// Read frontend/src/api.js and adapt it for running in a VM sandbox with mocked globals
const rawSource = readFileSync(resolve(__dirname, "../../frontend/src/api.js"), "utf8");

// Extract all function names that are exported
const exportedFuncs = [...rawSource.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)].map(m => m[1]);

function createApiContext(options = {}) {
  const {
    apiBaseUrl = "http://localhost:5000",
    windowOrigin = "http://localhost:3000",
    fetchMock = async () => ({ ok: true, status: 200, json: async () => ({}) })
  } = options;

  const storageMap = new Map();
  const mockLocalStorage = {
    getItem: (key) => storageMap.get(key) || null,
    setItem: (key, val) => storageMap.set(key, String(val)),
    removeItem: (key) => storageMap.delete(key),
    clear: () => storageMap.clear()
  };

  // Replace import with injected API_BASE_URL and strip "export " while preserving "async"
  const stripped = rawSource
    .replace("import { API_BASE_URL } from './config';", "const API_BASE_URL = injectedBaseUrl;")
    .replace(/export\s+(async\s+)?function\s+/g, (match, isAsync) => (isAsync ? "async function " : "function "));

  const exportAssignments = exportedFuncs.map(name => `exports.${name} = ${name};`).join("\n");

  const fullScript = `
    const exports = {};
    ${stripped}
    ${exportAssignments}
    exports;
  `;

  const sandbox = {
    injectedBaseUrl: apiBaseUrl,
    localStorage: mockLocalStorage,
    window: {
      location: {
        origin: windowOrigin
      }
    },
    fetch: fetchMock,
    Headers: globalThis.Headers,
    URL: globalThis.URL,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {}
    }
  };

  const api = runInNewContext(fullScript, sandbox);
  return { api, storageMap, sandbox };
}

test("frontend api: storage lifecycle handles token and user safely", () => {
  const { api, storageMap } = createApiContext();

  assert.equal(api.getAuthToken(), null);
  assert.equal(api.getAuthUser(), null);
  assert.equal(api.isAuthenticated(), false);

  const sampleToken = "verified.session.jwt.token";
  const sampleUser = { id: 42, name: "Alice", email: "alice@evolve.com", role: "operator" };

  api.setAuthToken(sampleToken);
  api.setAuthUser(sampleUser);

  assert.equal(api.getAuthToken(), sampleToken);
  const user = api.getAuthUser();
  assert.equal(user.id, sampleUser.id);
  assert.equal(user.name, sampleUser.name);
  assert.equal(user.email, sampleUser.email);
  assert.equal(user.role, sampleUser.role);
  assert.equal(api.isAuthenticated(), true);
  assert.equal(storageMap.get("evolve_verified_session_token"), sampleToken);

  // Logout clears credentials
  api.logout();
  assert.equal(api.getAuthToken(), null);
  assert.equal(api.getAuthUser(), null);
  assert.equal(api.isAuthenticated(), false);
  assert.equal(storageMap.has("evolve_verified_session_token"), false);
  assert.equal(storageMap.has("evolve_current_user"), false);
});

test("frontend api: isSafeApiOrigin allows local/configured origins and blocks third parties", () => {
  const { api } = createApiContext({
    apiBaseUrl: "http://localhost:5000",
    windowOrigin: "http://localhost:3000"
  });

  // Safe relative paths
  assert.equal(api.isSafeApiOrigin("/api/stations"), true);
  assert.equal(api.isSafeApiOrigin("/api/bookings/1"), true);

  // Safe absolute URLs matching API origin or Window origin
  assert.equal(api.isSafeApiOrigin("http://localhost:5000/api/stations"), true);
  assert.equal(api.isSafeApiOrigin("http://localhost:3000/api/bookings"), true);

  // Unsafe protocol-relative and foreign domains
  assert.equal(api.isSafeApiOrigin("//evil-domain.com/api/steal"), false);
  assert.equal(api.isSafeApiOrigin("https://evil-domain.com/steal"), false);
  assert.equal(api.isSafeApiOrigin("http://localhost:9999/api/stations"), false);
  assert.equal(api.isSafeApiOrigin(null), false);
  assert.equal(api.isSafeApiOrigin(""), false);
});

test("frontend api: apiFetch automatically attaches verified Authorization header to safe origin", async () => {
  let recordedUrl = null;
  let recordedHeaders = null;

  const mockFetch = async (url, options) => {
    recordedUrl = url;
    recordedHeaders = options.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true })
    };
  };

  const { api } = createApiContext({ fetchMock: mockFetch });
  api.setAuthToken("test-jwt-signature-token-12345");

  await api.apiFetch("/api/stations/1", { method: "PUT", body: JSON.stringify({ name: "Updated" }) });

  assert.equal(recordedUrl, "http://localhost:5000/api/stations/1");
  assert.ok(recordedHeaders instanceof Headers);
  assert.equal(recordedHeaders.get("Authorization"), "Bearer test-jwt-signature-token-12345");
  assert.equal(recordedHeaders.get("Content-Type"), "application/json");
});

test("frontend api: apiFetch does NOT attach Authorization header when unauthenticated", async () => {
  let recordedHeaders = null;

  const mockFetch = async (url, options) => {
    recordedHeaders = options.headers;
    return { ok: true, status: 200, json: async () => [] };
  };

  const { api } = createApiContext({ fetchMock: mockFetch });
  // No token set

  await api.apiFetch("/api/stations");
  assert.equal(recordedHeaders.get("Authorization"), null);
});

test("frontend api: apiFetch skips auth header when skipAuth: true", async () => {
  let recordedHeaders = null;

  const mockFetch = async (url, options) => {
    recordedHeaders = options.headers;
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };

  const { api } = createApiContext({ fetchMock: mockFetch });
  api.setAuthToken("test-token");

  await api.apiFetch("/api/login", {
    method: "POST",
    skipAuth: true,
    body: JSON.stringify({ email: "demo@evolve.com", password: "pwd" })
  });

  assert.equal(recordedHeaders.get("Authorization"), null);
});

test("frontend api: apiFetch does NOT attach Authorization header to external origins", async () => {
  let recordedHeaders = null;

  const mockFetch = async (url, options) => {
    recordedHeaders = options.headers;
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const { api } = createApiContext({ fetchMock: mockFetch });
  api.setAuthToken("secret-user-token");

  await api.apiFetch("https://external-service.org/telemetry", { method: "POST" });
  assert.equal(recordedHeaders.get("Authorization"), null);
});

test("frontend api: apiFetch clears token on 401 unauthorized response from protected routes", async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: "Unauthorized: Invalid or expired token" })
  });

  const { api } = createApiContext({ fetchMock: mockFetch });
  api.setAuthToken("expired-or-revoked-token");
  api.setAuthUser({ id: 1, name: "Test" });

  assert.equal(api.isAuthenticated(), true);

  await api.apiFetch("/api/bookings/10", { method: "DELETE" });

  // Token and user should be wiped on 401 from protected endpoint
  assert.equal(api.isAuthenticated(), false);
  assert.equal(api.getAuthToken(), null);
  assert.equal(api.getAuthUser(), null);
});

test("frontend api: apiFetch redacts bearer token from error messages", async () => {
  const mockFetch = async () => {
    throw new Error("Failed to connect with Bearer secret-auth-token-12345");
  };

  const { api } = createApiContext({ fetchMock: mockFetch });
  api.setAuthToken("secret-auth-token-12345");

  await assert.rejects(
    async () => {
      await api.apiFetch("/api/stations/1");
    },
    (err) => {
      assert.ok(!err.message.includes("secret-auth-token-12345"));
      assert.ok(err.message.includes("Bearer [REDACTED]"));
      return true;
    }
  );
});

test("frontend api: update and delete domain methods issue PUT and DELETE with authorization", async () => {
  const calls = [];

  const mockFetch = async (url, options) => {
    calls.push({
      url,
      method: options.method || "GET",
      auth: options.headers ? options.headers.get("Authorization") : null,
      body: options.body ? JSON.parse(options.body) : null
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, id: 1 })
    };
  };

  const { api } = createApiContext({ fetchMock: mockFetch });
  api.setAuthToken("operator-session-token");

  // Stations
  await api.updateStation(10, { name: "Station 10 Updated" });
  await api.deleteStation(10);

  // Chargers
  await api.updateCharger(20, { status: "MAINTENANCE" });
  await api.deleteCharger(20);

  // Bookings
  await api.updateBooking(30, { status: "CANCELLED" });
  await api.deleteBooking(30);

  // Sessions
  await api.updateSession(40, { energy_used_kwh: 50 });
  await api.deleteSession(40);

  assert.equal(calls.length, 8);

  const expectedMethods = ["PUT", "DELETE", "PUT", "DELETE", "PUT", "DELETE", "PUT", "DELETE"];
  const expectedUrls = [
    "http://localhost:5000/api/stations/10",
    "http://localhost:5000/api/stations/10",
    "http://localhost:5000/api/chargers/20",
    "http://localhost:5000/api/chargers/20",
    "http://localhost:5000/api/bookings/30",
    "http://localhost:5000/api/bookings/30",
    "http://localhost:5000/api/sessions/40",
    "http://localhost:5000/api/sessions/40"
  ];

  for (let i = 0; i < calls.length; i++) {
    assert.equal(calls[i].method, expectedMethods[i]);
    assert.equal(calls[i].url, expectedUrls[i]);
    assert.equal(calls[i].auth, "Bearer operator-session-token");
  }
});
