export const API_BASE_URL = import.meta.env.VITE_API_URL || (
  typeof window !== 'undefined' && window.location.hostname.includes('onrender.com')
    ? 'https://evolve-qvy1.onrender.com'
    : 'http://localhost:5000'
);

