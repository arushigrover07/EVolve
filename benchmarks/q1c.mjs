import http from 'k6/http';
import { sleep } from 'k6';
import execution from 'k6/execution';
import { Counter } from 'k6/metrics';
import { classifyResponse } from './failure-classification.mjs';

const phase = __ENV.PHASE;
if (!['Before','After'].includes(phase) || !__ENV.RAW_SUMMARY_FILE) throw new Error('Use the reviewed failure runner.');
const counts = Object.fromEntries(['success','timeouts','transportErrors','httpNon2xx'].map((name) => [name, new Counter(`q1c_${name}`)]));
export const options = {
  discardResponseBodies: true, maxRedirects: 0, insecureSkipTLSVerify: false,
  scenarios: { failure: { executor: 'shared-iterations', vus: 20, iterations: 1000, maxDuration: '30m', gracefulStop: '25s' } },
  thresholds: { http_reqs: ['count==1000'], iterations: ['count==1000'] },
};
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }));
export default function () {
  const settings = execution.test.options.scenarios.failure;
  if (settings.executor !== 'shared-iterations' || settings.vus !== 20 || settings.iterations !== 1000) throw new Error('Unexpected effective failure workload');
  const id = `${execution.vu.idInTest}-${execution.vu.iterationInScenario}`;
  console.log(JSON.stringify({ event: 'start', id, time: new Date().toISOString() }));
  const response = http.get('http://127.0.0.1:5173/api/stations', { timeout: '20s', redirects: 0, tags: { name: 'GET /api/stations' } });
  const category = classifyResponse(response);
  counts[category].add(1);
  console.log(JSON.stringify({ event: 'end', id, time: new Date().toISOString(), status: response.status, category, errorCode: response.error_code || null }));
  sleep(0.5); // Identical pacing makes the 1000-request run long enough for the stop event.
}
export function handleSummary(data) {
  return { [__ENV.RAW_SUMMARY_FILE]: JSON.stringify({ phase, endpoint: 'http://127.0.0.1:5173/api/stations', rawSummary: data }, null, 2), stdout: 'Failure experiment raw summary saved; validation pending.\n' };
}
