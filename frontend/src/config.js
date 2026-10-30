// Explicit Compose mode: append /api/... to the browser's current origin.
// Unset/empty values retain the existing local-development and Render fallbacks.
const configuredApiUrl = import.meta.env.VITE_API_URL;
export const API_BASE_URL = configuredApiUrl === "/" ? "" : configuredApiUrl || (
  typeof window !== 'undefined' && window.location.hostname.includes('onrender.com')
    ? 'https://evolve-qvy1.onrender.com'
    : 'http://localhost:5000'
);

