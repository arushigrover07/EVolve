const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validateResult, compareResults, derive, finalize, hash, targets, readValidated } = require('./result-validation.cjs');
const source = fs.readFileSync(path.join(__dirname, 'q1b.mjs'), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
function fixture(configuration = 'One') {
  const raw = { state: { testRunDurationMs: 10000 }, root_group: { checks: [{ name: 'HTTP 200', passes: 1000, fails: 0 }] }, metrics: {
    http_reqs: { values: { count: 1000, rate: 100 }, thresholds: { 'count==1000': { ok: true } } },
    iterations: { values: { count: 1000 } },
    checks: { values: { passes: 1000, fails: 0, rate: 1 }, thresholds: { 'rate==1': { ok: true } } },
    http_req_failed: { values: { passes: 0, fails: 1000, rate: 0 }, thresholds: { 'rate==0': { ok: true } } },
    http_req_duration: { values: { avg: 10 } },
  } };
  for (const [name, value] of Object.entries({ concurrency: 20, planned_iterations: 1000, timeout_seconds: 20, redirects: 0, shared_executor: 1 })) raw.metrics[`q1b_${name}`] = { values: { value, min: value, max: value } };
  return { schemaVersion: 2, configuration, endpoint: targets[configuration], toolName: 'k6', toolVersion: 'k6 v1.0.0 (synthetic fixture)',
    toolSha256: 'a'.repeat(64), workloadSha256: 'b'.repeat(64), proxyConfigSha256: 'c'.repeat(64), rawSummarySha256: 'd'.repeat(64), metadataSha256: 'd'.repeat(64), metadataFile: `${configuration}.meta.json`,
    backendImage: `sha256:${'e'.repeat(64)}`, proxyImage: `sha256:${'f'.repeat(64)}`, backendImages: Array(3).fill(`sha256:${'e'.repeat(64)}`),
    dataBeforeSha256: '1'.repeat(64), dataAfterSha256: '1'.repeat(64), warmupRequests: 0,
    runId: '11111111-1111-4111-8111-111111111111', rawSummaryFile: `${configuration}.raw.json`, status: 'accepted', processExitCode: 0,
    ...derive(raw), rawSummary: raw };
}
// Synthetic fixtures only. No request, Docker operation or real result artifact is produced.
test('valid measured schema and matching pair are accepted', () => {
  assert.equal(validateResult(fixture()).status, 'accepted');
  assert.equal(compareResults(fixture(), fixture('Three')).rpsImprovementPercent, 0);
});
for (const field of Object.keys(fixture())) test(`rejects missing required field: ${field}`, () => {
  const value = fixture(); delete value[field]; assert.throws(() => validateResult(value));
});
const invalid = {
  configuration: ['Public', '', null, ['One']], endpoint: ['http://example.invalid/api/stations', '', null],
  toolName: ['hey', '', null], toolVersion: ['', ' ', null, 'unknown'], toolSha256: ['', 'x'.repeat(64), null],
  status: ['rejected', true, '', null], processExitCode: [1, -1, '0', null],
  requestCount: [999, 1001, '1000', null], completedIterations: [999, '1000', null], successfulChecks: [999, '1000', null],
  failedRequests: [1, '0', null], checksFailed: [1, '0', null], durationSeconds: [0, -1, '10', null, NaN, Infinity],
  requestsPerSecond: [0, -1, '100', null, NaN, Infinity], averageResponseTimeMs: [-1, '10', null, NaN, Infinity],
  concurrency: [1, '20', null], timeoutSeconds: [0, '20', null], executor: ['constant-vus', '', null],
  backendImages: [[], ['wrong'], null], rawSummary: [null, {}, []], rawSummaryFile: ['', null],
};
for (const [field, values] of Object.entries(invalid)) test(`rejects malformed/failed values: ${field}`, () => {
  for (const bad of values) { const result = fixture(); result[field] = bad; assert.throws(() => validateResult(result)); }
});
test('rejects raw counts, check identity, thresholds and effective workload inconsistencies', () => {
  for (const mutate of [
    (r) => { r.rawSummary.metrics.http_reqs.values.count = 999; },
    (r) => { r.rawSummary.metrics.checks.values.passes = 999; },
    (r) => { r.rawSummary.metrics.http_req_failed.values.fails = 999; },
    (r) => { r.rawSummary.metrics.http_req_failed.values.rate = 0.1; },
    (r) => { r.rawSummary.root_group.checks[0].name = 'Other'; },
    (r) => { r.rawSummary.metrics.http_reqs.thresholds['count==1000'].ok = false; },
    (r) => { delete r.rawSummary.metrics.checks.thresholds; },
    (r) => { r.rawSummary.metrics.q1b_concurrency.values.min = 1; },
  ]) { const result = fixture(); mutate(result); assert.throws(() => validateResult(result)); }
});
test('comparator rejects incompatible tool, image and workload identities and swapped configurations', () => {
  for (const field of ['toolVersion','toolSha256','workloadSha256','backendImage','proxyImage']) {
    const three = fixture('Three'); three[field] = field === 'toolVersion' ? 'k6 v2.0.0' : (field.endsWith('Image') ? `sha256:${'1'.repeat(64)}` : '1'.repeat(64));
    assert.throws(() => compareResults(fixture(), three));
  }
  assert.throws(() => compareResults(fixture('Three'), fixture()));
});
test('negative improvements are retained and a zero baseline mean is handled without division by zero', () => {
  const three = fixture('Three'); three.requestsPerSecond = three.rawSummary.metrics.http_reqs.values.rate = 50;
  three.averageResponseTimeMs = three.rawSummary.metrics.http_req_duration.values.avg = 20;
  assert.equal(compareResults(fixture(), three).rpsImprovementPercent, -50);
  assert.equal(compareResults(fixture(), three).averageResponseTimeReductionPercent, -100);
  const one = fixture(); one.averageResponseTimeMs = one.rawSummary.metrics.http_req_duration.values.avg = 0;
  assert.equal(compareResults(one, fixture('Three')).averageResponseTimeReductionPercent, null);
});
function load(configuration, scenario = { executor: 'shared-iterations', vus: 20, iterations: 1000 }) {
  const requests = [], gauges = {};
  const code = source.replace(/^import .*;$/gm, '').replace('export const options', 'const options').replace('export default function ()', 'function iteration()').replace('export function handleSummary', 'function handleSummary') + '\n({options,iteration,handleSummary});';
  const module = vm.runInNewContext(code, { __ENV: { CONFIGURATION: configuration, RAW_SUMMARY_FILE: 'fixture.raw.json' },
    execution: { test: { options: { scenarios: { comparison: scenario } } } },
    Gauge: class { constructor(name) { this.name = name; } add(value) { gauges[this.name] = value; } },
    http: { expectedStatuses: (status) => status, setResponseCallback: (status) => assert.equal(status, 200), get: (url, options) => { requests.push({ url, options }); return { status: 200 }; } },
    check: (response, checks) => { for (const predicate of Object.values(checks)) assert.equal(predicate(response), true); },
  });
  return { ...module, requests, gauges };
}
test('one GET per iteration, no redirects, and observed executor settings recorded for both plans', () => {
  for (const configuration of ['One','Three']) {
    const module = load(configuration); module.iteration();
    assert.equal(module.requests.length, 1); assert.equal(module.requests[0].url, targets[configuration]);
    assert.equal(module.requests[0].options.timeout, '20s'); assert.equal(module.requests[0].options.redirects, 0);
    assert.equal(module.gauges.q1b_concurrency, 20); assert.equal(module.gauges.q1b_planned_iterations, 1000);
    assert.equal(module.options.insecureSkipTLSVerify, false);
    const artifact = JSON.parse(module.handleSummary(fixture().rawSummary)['fixture.raw.json']);
    assert.equal(artifact.configuration, configuration); assert.equal(artifact.status, undefined);
  }
  const wrong = load('One', { executor: 'shared-iterations', vus: 1, iterations: 1000 });
  assert.throws(() => wrong.iteration(), /effective workload/); assert.equal(wrong.requests.length, 0);
  assert.throws(() => load('Public'));
});
test('benchmark proxy configs disable retries and differ only by upstream membership', () => {
  const one = fs.readFileSync(path.join(__dirname, 'nginx.one.conf'), 'utf8');
  const three = fs.readFileSync(path.join(__dirname, 'nginx.three.conf'), 'utf8');
  const normalize = (s) => s.replace(/^#.*\r?\n/, '').replace(/\r\n/g, '\n');
  assert.equal(normalize(one), normalize(three).replace('    server backend2:5000;\n', '').replace('    server backend3:5000;\n', ''));
  assert.match(one, /proxy_next_upstream off;/); assert.match(three, /proxy_next_upstream off;/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../frontend/nginx.compose.conf'), 'utf8'), /proxy_next_upstream off;/);
});
test('file-level validation rejects missing/malformed/tampered raw artifacts; failed exits stay rejected', () => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'evolve-q1b-unit-'));
  const files = ['One.meta.json','One.raw.json','One.json'].map((name) => path.join(directory, name));
  try {
    assert.throws(() => readValidated(files[2], 'One'));
    fs.writeFileSync(files[2], '{'); assert.throws(() => readValidated(files[2], 'One')); fs.unlinkSync(files[2]);
    const metadata = fixture(); metadata.processExitCode = 1;
    fs.writeFileSync(files[0], JSON.stringify(metadata));
    fs.writeFileSync(files[1], JSON.stringify({ configuration: 'One', endpoint: targets.One, rawSummary: metadata.rawSummary }));
    assert.equal(finalize(...files), false);
    assert.equal(JSON.parse(fs.readFileSync(files[2])).status, 'rejected');
    assert.equal(JSON.parse(fs.readFileSync(files[2])).processExitCode, 1);
    assert.throws(() => readValidated(files[2], 'One')); fs.unlinkSync(files[2]);
    metadata.processExitCode = 0; metadata.workloadSha256 = hash(fs.readFileSync(path.join(__dirname, 'q1b.mjs'))); metadata.proxyConfigSha256 = hash(fs.readFileSync(path.join(__dirname, 'nginx.one.conf')));
    fs.writeFileSync(files[0], JSON.stringify(metadata));
    assert.equal(finalize(...files), true); assert.equal(readValidated(files[2], 'One').status, 'accepted');
    fs.appendFileSync(files[0], ' '); assert.throws(() => readValidated(files[2], 'One'));
    fs.writeFileSync(files[0], JSON.stringify(metadata));
    fs.appendFileSync(files[1], ' '); assert.throws(() => readValidated(files[2], 'One'));
  } finally {
    for (const file of files) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
});

test('Windows native k6.exe version string is accepted without normalization', () => { const result=fixture(); result.toolVersion='k6.exe v1.8.2 (synthetic fixture)'; assert.equal(validateResult(result).toolVersion,result.toolVersion); });

test('data changes within or across runs invalidate a performance comparison', () => { const changed=fixture(); changed.dataAfterSha256='2'.repeat(64); assert.throws(()=>validateResult(changed)); const three=fixture('Three');three.dataBeforeSha256=three.dataAfterSha256='2'.repeat(64);assert.throws(()=>compareResults(fixture(),three)); });
