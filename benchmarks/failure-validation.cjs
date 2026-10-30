const fs = require('node:fs');
function events(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const begin = line.indexOf('{'), end = line.lastIndexOf('}');
    if (begin < 0 || end < begin) continue;
    let value;
    try { value = JSON.parse(line.slice(begin, end + 1)); } catch {
      try { value = JSON.parse(line.slice(begin, end + 1).replace(/\\"/g, '"')); } catch { continue; }
    }
    if (['start','end'].includes(value.event)) rows.push(value);
  }
  return rows;
}
function progress(text) {
  const rows = events(text), active = new Set(); let started = 0, finished = 0, firstRequestAt;
  for (const row of rows) {
    if (row.event === 'start') { started++; active.add(row.id); firstRequestAt ||= row.time; }
    else { finished++; active.delete(row.id); }
  }
  return { started, finished, inFlight: active.size, firstRequestAt };
}
function validateFailure(artifact, text, metadata) {
  const fail = (message) => { throw new Error(`Invalid failure evidence: ${message}`); };
  if (!['Before','After'].includes(artifact.phase) || artifact.phase !== metadata.phase || artifact.endpoint !== 'http://127.0.0.1:5173/api/stations') fail('phase/endpoint');
  if (metadata.processExitCode !== 0 || metadata.concurrency !== 20 || metadata.timeoutSeconds !== 20 || metadata.requestCount !== 1000 || metadata.pacingSeconds !== 0.5 || metadata.stopDelaySeconds !== 8) fail('workload/exit');
  if (!/^sha256:[a-f0-9]{64}$/.test(metadata.backendImage || '') || !/^[a-f0-9]{64}$/.test(metadata.targetContainerId || '') || metadata.targetService !== 'backend3' || metadata.recoverySucceeded !== true) fail('target/recovery');
  if (typeof metadata.toolVersion !== 'string' || !/^k6(?:\.exe)? v\d+\.\d+\.\d+/.test(metadata.toolVersion) || !/^[a-f0-9]{64}$/i.test(metadata.toolSha256 || '') || !/^[a-f0-9]{64}$/i.test(metadata.workloadSha256 || '') || !/^sha256:[a-f0-9]{64}$/.test(metadata.proxyImage || '')) fail('tool/workload identity');
  if (!/^[a-f0-9]{64}$/.test(metadata.dataBeforeSha256 || '') || metadata.dataBeforeSha256 !== metadata.dataAfterSha256) fail('unstable data snapshot');
  const rows = events(text), starts = rows.filter((r) => r.event === 'start'), ends = rows.filter((r) => r.event === 'end');
  if (starts.length !== 1000 || ends.length !== 1000 || new Set(starts.map((r) => r.id)).size !== 1000 || new Set(ends.map((r) => r.id)).size !== 1000) fail('request log count');
  const started = new Set(starts.map((r) => r.id)); if (ends.some((r) => !started.has(r.id))) fail('unmatched end');
  const stop = Date.parse(metadata.stopRequestedAt), first = Math.min(...starts.map((r) => Date.parse(r.time))), last = Math.max(...ends.map((r) => Date.parse(r.time)));
  if (!Number.isFinite(stop) || !(stop >= first + 8000 && stop < last) || metadata.observedInFlight < 1) fail('stop outside active load');
  const activeAtStop = starts.filter((r) => Date.parse(r.time) <= stop).length - ends.filter((r) => Date.parse(r.time) <= stop).length;
  if (activeAtStop < 1) fail('no request overlapped stop timestamp');
  const categories = { success: 0, timeouts: 0, transportErrors: 0, httpNon2xx: 0 };
  for (const row of ends) {
    if (!Object.hasOwn(categories, row.category)) fail('category');
    if (row.category === 'success' && !(row.status >= 200 && row.status < 300)) fail('success status');
    if (row.category === 'httpNon2xx' && !(row.status > 0 && (row.status < 200 || row.status >= 300))) fail('HTTP status');
    if (['timeouts','transportErrors'].includes(row.category) && row.status !== 0) fail('transport status');
    categories[row.category]++;
  }
  const raw = artifact.rawSummary;
  if (raw?.metrics?.http_reqs?.values?.count !== 1000 || raw?.metrics?.iterations?.values?.count !== 1000) fail('raw request/iteration count');
  for (const name of Object.keys(categories)) if ((raw.metrics[`q1c_${name}`]?.values?.count || 0) !== categories[name]) fail('raw category count');
  const failedRequests = categories.timeouts + categories.transportErrors + categories.httpNon2xx;
  if (raw.metrics.http_req_failed?.values?.passes !== failedRequests || raw.metrics.http_req_failed?.values?.fails !== categories.success) fail('raw failure count');
  for (const metric of Object.values(raw.metrics)) for (const threshold of Object.values(metric.thresholds || {})) if (threshold.ok !== true) fail('threshold');
  return { phase: artifact.phase, dataBeforeSha256: metadata.dataBeforeSha256, toolVersion: metadata.toolVersion, toolSha256: metadata.toolSha256, backendImage: metadata.backendImage, proxyImage: metadata.proxyImage, workloadSha256: metadata.workloadSha256, concurrency: 20, timeoutSeconds: 20, pacingSeconds: 0.5, stopDelaySeconds: 8, actualStopOffsetSeconds: (stop-first)/1000, clientRequests: 1000, successfulRequests: categories.success, failedRequests, transportErrors: categories.transportErrors, timeouts: categories.timeouts, httpNon2xx: categories.httpNon2xx, stopRequestedAt: metadata.stopRequestedAt, observedInFlight: metadata.observedInFlight, recoverySucceeded: true, backendAttempts: null, sqlStatements: null };
}
if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'progress') console.log(JSON.stringify(progress(fs.existsSync(args[0]) ? fs.readFileSync(args[0], 'utf8') : '')));
    else if (command === 'validate') console.log(JSON.stringify(validateFailure(JSON.parse(fs.readFileSync(args[0], 'utf8').replace(/^\uFEFF/, '')), fs.readFileSync(args[1], 'utf8'), JSON.parse(fs.readFileSync(args[2], 'utf8').replace(/^\uFEFF/, ''))), null, 2));
    else if (command === 'compare') {
      const path = require('node:path');
      const read = (phase) => validateFailure(JSON.parse(fs.readFileSync(path.join(args[0],phase+'.raw.json'),'utf8').replace(/^\uFEFF/,'')),fs.readFileSync(path.join(args[0],phase+'.requests.log'),'utf8'),JSON.parse(fs.readFileSync(path.join(args[0],phase+'.meta.json'),'utf8').replace(/^\uFEFF/,'')));
      const before=read('Before'),after=read('After');
      for(const field of ['toolVersion','toolSha256','backendImage','proxyImage','workloadSha256','concurrency','timeoutSeconds','pacingSeconds','stopDelaySeconds','clientRequests','dataBeforeSha256'])if(before[field]!==after[field])throw new Error('Mismatched failure experiments');
      console.log(JSON.stringify({before,after,zeroFailuresDemonstrated:after.failedRequests===0},null,2));
    }
    else throw new Error('Unknown failure validation command');
  } catch { console.error('Failure experiment incomplete or inconsistent; no valid failure count claimed.'); process.exitCode = 1; }
}
module.exports = { events, progress, validateFailure };
