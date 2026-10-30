import http from 'k6/http';
import { check } from 'k6';
import execution from 'k6/execution';
import { Gauge } from 'k6/metrics';

const targets = { One: 'http://127.0.0.1:5174/api/stations', Three: 'http://127.0.0.1:5173/api/stations' };
const configuration = __ENV.CONFIGURATION;
const target = targets[configuration];
if (!Object.prototype.hasOwnProperty.call(targets, configuration) || !__ENV.RAW_SUMMARY_FILE) throw new Error('Use the reviewed benchmark wrapper.');
const requestOptions = { timeout: '20s', redirects: 0, tags: { name: 'GET /api/stations' } };
const gauges = Object.fromEntries(['concurrency', 'planned_iterations', 'timeout_seconds', 'redirects', 'shared_executor'].map((name) => [name, new Gauge(`q1b_${name}`)]));
export const options = {
  discardResponseBodies: true,
  maxRedirects: 0,
  insecureSkipTLSVerify: false,
  scenarios: { comparison: { executor: 'shared-iterations', vus: 20, iterations: 1000, maxDuration: '30m', gracefulStop: '25s' } },
  thresholds: { http_reqs: ['count==1000'], http_req_failed: ['rate==0'], checks: ['rate==1'] },
};
http.setResponseCallback(http.expectedStatuses(200));
export default function () {
  // Read the resolved executor settings, not merely the script defaults.
  const scenarios = execution.test.options.scenarios;
  const scenario = scenarios.comparison;
  if (Object.keys(scenarios).length !== 1 || !scenario || scenario.executor !== 'shared-iterations' || scenario.vus !== 20 || scenario.iterations !== 1000) throw new Error('Unexpected effective workload');
  gauges.concurrency.add(scenario.vus);
  gauges.planned_iterations.add(scenario.iterations);
  gauges.timeout_seconds.add(Number(requestOptions.timeout.slice(0, -1)));
  gauges.redirects.add(requestOptions.redirects);
  gauges.shared_executor.add(scenario.executor === 'shared-iterations' ? 1 : 0);
  const response = http.get(target, requestOptions);
  check(response, { 'HTTP 200': (r) => r.status === 200 });
}
// No setup(), teardown(), scripted retries or additional HTTP calls.
export function handleSummary(data) {
  // k6 writes raw evidence only. The wrapper decides acceptance AFTER process exit.
  return {
    [__ENV.RAW_SUMMARY_FILE]: JSON.stringify({ configuration, endpoint: target, rawSummary: data }, null, 2),
    stdout: 'Raw benchmark summary saved; wrapper acceptance is pending.\n',
  };
}
