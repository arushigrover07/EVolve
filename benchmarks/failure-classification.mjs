// Disjoint client failure categories. Never count a timeout twice as transport error.
export function classifyResponse(response) {
  if (response.status >= 200 && response.status < 300) return 'success';
  if (response.status > 0) return 'httpNon2xx';
  if (response.error_code === 1050 || /timeout|deadline/i.test(response.error || '')) return 'timeouts';
  return 'transportErrors';
}
