const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const targets = { One: 'http://127.0.0.1:5174/api/stations', Three: 'http://127.0.0.1:5173/api/stations' };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fail = (field) => { throw new Error(`Invalid benchmark field: ${field}`); };
function number(value, field, minimum = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) fail(field);
  return value;
}
function equal(actual, expected, field) { if (actual !== expected) fail(field); }
function text(value, field, pattern) {
  if (typeof value !== 'string' || !value.trim() || (pattern && !pattern.test(value))) fail(field);
}
function gauge(raw, name, expected) {
  const values = raw.metrics?.[name]?.values;
  for (const key of ['value', 'min', 'max']) equal(values?.[key], expected, `${name}.${key}`);
  return values.value;
}
function derive(raw) {
  return {
    requestCount: raw?.metrics?.http_reqs?.values?.count,
    completedIterations: raw?.metrics?.iterations?.values?.count,
    successfulChecks: raw?.metrics?.checks?.values?.passes,
    checksFailed: raw?.metrics?.checks?.values?.fails,
    failedRequests: raw?.metrics?.http_req_failed?.values?.passes,
    requestsPerSecond: raw?.metrics?.http_reqs?.values?.rate,
    averageResponseTimeMs: raw?.metrics?.http_req_duration?.values?.avg,
    durationSeconds: typeof raw?.state?.testRunDurationMs === 'number' ? raw.state.testRunDurationMs / 1000 : undefined,
    concurrency: raw?.metrics?.q1b_concurrency?.values?.value,
    plannedIterations: raw?.metrics?.q1b_planned_iterations?.values?.value,
    timeoutSeconds: raw?.metrics?.q1b_timeout_seconds?.values?.value,
    maxRedirects: raw?.metrics?.q1b_redirects?.values?.value,
    executor: raw?.metrics?.q1b_shared_executor?.values?.value === 1 ? 'shared-iterations' : undefined,
  };
}
function validateResult(result, expectedConfiguration) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('result');
  equal(result.schemaVersion, 2, 'schemaVersion');
  if (typeof result.configuration !== 'string' || !Object.hasOwn(targets, result.configuration)) fail('configuration');
  if (expectedConfiguration) equal(result.configuration, expectedConfiguration, 'configuration');
  equal(result.endpoint, targets[result.configuration], 'endpoint');
  equal(result.toolName, 'k6', 'toolName');
  text(result.toolVersion, 'toolVersion', /^k6(?:\.exe)? v\d+\.\d+\.\d+[^\r\n]*$/);
  for (const field of ['toolSha256', 'workloadSha256', 'proxyConfigSha256', 'rawSummarySha256', 'metadataSha256', 'dataBeforeSha256', 'dataAfterSha256']) text(result[field], field, /^[a-f0-9]{64}$/i);
  for (const field of ['backendImage', 'proxyImage']) text(result[field], field, /^sha256:[a-f0-9]{64}$/);
  if (!Array.isArray(result.backendImages) || result.backendImages.length !== 3 || result.backendImages.some((image) => image !== result.backendImage)) fail('backendImages');
  text(result.runId, 'runId', /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
  text(result.rawSummaryFile, 'rawSummaryFile');
  text(result.metadataFile, 'metadataFile');
  equal(result.dataBeforeSha256, result.dataAfterSha256, 'stable data snapshot');
  equal(result.warmupRequests, 0, 'warmupRequests');
  equal(result.status, 'accepted', 'status');
  equal(result.processExitCode, 0, 'processExitCode');
  const raw = result.rawSummary;
  if (!raw || typeof raw !== 'object') fail('rawSummary');
  const derived = derive(raw);
  for (const [field, value] of Object.entries(derived)) {
    if (field !== 'executor') number(value, `raw.${field}`);
    equal(result[field], value, field);
  }
  for (const field of ['requestCount', 'completedIterations', 'successfulChecks', 'plannedIterations']) equal(result[field], 1000, field);
  for (const field of ['failedRequests', 'checksFailed', 'maxRedirects']) equal(result[field], 0, field);
  equal(result.concurrency, 20, 'concurrency');
  equal(result.timeoutSeconds, 20, 'timeoutSeconds');
  equal(result.executor, 'shared-iterations', 'executor');
  if (!(result.durationSeconds > 0) || !(result.requestsPerSecond > 0)) fail('positive duration/rate');
  equal(raw.metrics.http_req_failed.values.fails, 1000, 'raw.http_req_failed.fails');
  equal(raw.metrics.http_req_failed.values.rate, 0, 'raw.http_req_failed.rate');
  equal(raw.metrics.checks.values.rate, 1, 'raw.checks.rate');
  const checks = raw.root_group?.checks;
  if (!Array.isArray(checks) || checks.length !== 1) fail('HTTP-200 check identity');
  equal(checks[0].name, 'HTTP 200', 'check.name');
  equal(checks[0].passes, 1000, 'check.passes');
  equal(checks[0].fails, 0, 'check.fails');
  for (const [name, expected] of Object.entries({ q1b_concurrency: 20, q1b_planned_iterations: 1000, q1b_timeout_seconds: 20, q1b_redirects: 0, q1b_shared_executor: 1 })) gauge(raw, name, expected);
  for (const [metric, threshold] of [['http_reqs', 'count==1000'], ['http_req_failed', 'rate==0'], ['checks', 'rate==1']]) equal(raw.metrics[metric]?.thresholds?.[threshold]?.ok, true, `threshold.${metric}`);
  for (const metric of Object.values(raw.metrics)) {
    for (const threshold of Object.values(metric.thresholds || {})) equal(threshold.ok, true, 'threshold');
  }
  return result;
}
function compareResults(one, three) {
  validateResult(one, 'One'); validateResult(three, 'Three');
  for (const field of ['toolName', 'toolVersion', 'toolSha256', 'workloadSha256', 'backendImage', 'proxyImage', 'concurrency', 'timeoutSeconds', 'requestCount', 'executor', 'dataBeforeSha256', 'warmupRequests']) equal(one[field], three[field], `matching ${field}`);
  return {
    rows: [one, three].map((r) => Object.fromEntries(['configuration', 'toolName', 'toolVersion', 'requestCount', 'completedIterations', 'concurrency', 'failedRequests', 'durationSeconds', 'requestsPerSecond', 'averageResponseTimeMs'].map((key) => [key, r[key]]))),
    rpsImprovementPercent: ((three.requestsPerSecond - one.requestsPerSecond) / one.requestsPerSecond) * 100,
    averageResponseTimeReductionPercent: one.averageResponseTimeMs === 0 ? null : ((one.averageResponseTimeMs - three.averageResponseTimeMs) / one.averageResponseTimeMs) * 100,
    note: one.averageResponseTimeMs === 0 ? 'Response-time reduction is undefined because the baseline mean is zero.' : 'Negative improvements are retained.',
  };
}
function readValidated(file, configuration) {
  const result = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  validateResult(result, configuration);
  const rawFile = path.resolve(path.dirname(file), `${configuration}.raw.json`);
  equal(path.resolve(result.rawSummaryFile), rawFile, 'rawSummaryFile location');
  const metadataFile = path.resolve(path.dirname(file), `${configuration}.meta.json`);
  equal(path.resolve(result.metadataFile), metadataFile, 'metadataFile location');
  const metadataBytes = fs.readFileSync(metadataFile);
  equal(hash(metadataBytes), result.metadataSha256, 'metadata file hash');
  const metadata = JSON.parse(metadataBytes.toString('utf8').replace(/^\uFEFF/, ''));
  for (const field of ['configuration', 'endpoint', 'toolName', 'toolVersion', 'toolSha256', 'workloadSha256', 'proxyConfigSha256', 'backendImage', 'proxyImage', 'backendImages', 'runId', 'processExitCode', 'dataBeforeSha256', 'dataAfterSha256', 'warmupRequests']) equal(JSON.stringify(metadata[field]), JSON.stringify(result[field]), `metadata.${field}`);
  const bytes = fs.readFileSync(rawFile);
  equal(hash(bytes), result.rawSummarySha256, 'raw summary file hash');
  const artifact = JSON.parse(bytes.toString('utf8'));
  equal(artifact.configuration, configuration, 'raw configuration');
  equal(artifact.endpoint, result.endpoint, 'raw endpoint');
  equal(JSON.stringify(artifact.rawSummary), JSON.stringify(result.rawSummary), 'raw summary file contents');
  equal(hash(fs.readFileSync(path.join(__dirname, 'q1b.mjs'))), result.workloadSha256, 'current workload hash');
  equal(hash(fs.readFileSync(path.join(__dirname, configuration === 'One' ? 'nginx.one.conf' : 'nginx.three.conf'))), result.proxyConfigSha256, 'current proxy hash');
  return result;
}
function finalize(metaFile, rawFile, resultFile) {
  const metadataBytes = fs.readFileSync(metaFile);
  const meta = JSON.parse(metadataBytes.toString('utf8').replace(/^\uFEFF/, ''));
  const result = { ...meta, schemaVersion: 2, status: 'rejected', rawSummaryFile: path.resolve(rawFile), metadataFile: path.resolve(metaFile), metadataSha256: hash(metadataBytes) };
  try {
    const bytes = fs.readFileSync(rawFile);
    const artifact = JSON.parse(bytes.toString('utf8'));
    equal(artifact.configuration, meta.configuration, 'raw configuration');
    equal(artifact.endpoint, meta.endpoint, 'raw endpoint');
    Object.assign(result, derive(artifact.rawSummary), { rawSummary: artifact.rawSummary, rawSummarySha256: hash(bytes), status: 'accepted' });
    validateResult(result, meta.configuration);
  } catch (error) {
    result.status = 'rejected';
    result.rejectionReason = error.message.startsWith('Invalid benchmark field:') ? error.message : 'Missing or malformed raw summary';
  }
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2), { flag: 'wx' });
  return result.status === 'accepted';
}
if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'finalize' && args.length === 3) { if (!finalize(...args)) process.exitCode = 1; }
    else if (command === 'compare' && args.length === 2) console.log(JSON.stringify(compareResults(readValidated(args[0], 'One'), readValidated(args[1], 'Three')), null, 2));
    else throw new Error('Invalid validator command');
  } catch { console.error('Benchmark validation failed; missing, malformed, rejected or incompatible artifacts.'); process.exitCode = 1; }
}
module.exports = { validateResult, compareResults, derive, finalize, readValidated, hash, targets };
