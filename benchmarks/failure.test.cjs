const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { progress, validateFailure } = require('./failure-validation.cjs');
const classify = vm.runInNewContext(fs.readFileSync(path.join(__dirname,'failure-classification.mjs'),'utf8').replace('export function','function')+';classifyResponse;');
test('failure categories are disjoint and include HTTP, timeout and transport failures', () => {
  for (const [response, expected] of [[{status:200},'success'],[{status:299},'success'],[{status:302},'httpNon2xx'],[{status:500},'httpNon2xx'],[{status:0,error_code:1050},'timeouts'],[{status:0,error:'deadline exceeded'},'timeouts'],[{status:0,error_code:1212},'transportErrors']]) assert.equal(classify(response),expected);
});
function fixture(phase='Before', failed=1) {
  const first=Date.parse('2026-10-30T12:00:00Z');
  const rows=[]; for(let i=0;i<1000;i++){ rows.push({event:'start',id:String(i),time:new Date(first).toISOString()}); rows.push({event:'end',id:String(i),time:new Date(first+10000).toISOString(),status:i<failed?502:200,category:i<failed?'httpNon2xx':'success'}); }
  const raw={metrics:{http_reqs:{values:{count:1000},thresholds:{'count==1000':{ok:true}}},iterations:{values:{count:1000}},q1c_success:{values:{count:1000-failed}},q1c_httpNon2xx:{values:{count:failed}},http_req_failed:{values:{passes:failed,fails:1000-failed}}}};
  const metadata={dataBeforeSha256:'1'.repeat(64),dataAfterSha256:'1'.repeat(64),toolVersion:'k6.exe v1.8.2 (synthetic fixture)',toolSha256:'a'.repeat(64),workloadSha256:'b'.repeat(64),proxyImage:'sha256:'+'c'.repeat(64),phase,requestCount:1000,concurrency:20,timeoutSeconds:20,pacingSeconds:0.5,stopDelaySeconds:8,processExitCode:0,backendImage:'sha256:'+'a'.repeat(64),targetContainerId:'b'.repeat(64),targetService:'backend3',recoverySucceeded:true,stopRequestedAt:new Date(first+8500).toISOString(),observedInFlight:20};
  return {artifact:{phase,endpoint:'http://127.0.0.1:5173/api/stations',rawSummary:raw},text:rows.map(JSON.stringify).join('\n'),metadata};
}
test('complete before/after experiments retain actual failure counts including measured zero',()=>{
 for(const [phase,failed] of [['Before',1],['After',0],['After',2]]){const f=fixture(phase,failed);assert.equal(validateFailure(f.artifact,f.text,f.metadata).failedRequests,failed);}
});
test('incomplete, mismatched, unrecovered or non-overlapping evidence is rejected',()=>{
 for(const mutate of [(f)=>{f.metadata.processExitCode=1},(f)=>{f.metadata.recoverySucceeded=false},(f)=>{f.metadata.observedInFlight=0},(f)=>{f.metadata.stopRequestedAt='2026-10-30T12:01:00Z'},(f)=>{f.artifact.rawSummary.metrics.http_reqs.values.count=999},(f)=>{f.text=f.text.split('\n').slice(1).join('\n')},(f)=>{f.metadata.concurrency=1},(f)=>{f.artifact.rawSummary.metrics.q1c_httpNon2xx.values.count=2}]){const f=fixture();mutate(f);assert.throws(()=>validateFailure(f.artifact,f.text,f.metadata));}
});
test('progress uses request-start/end events and failure config enables bounded GET-only failover',()=>{
 assert.equal(progress('{"event":"start","id":"1","time":"2026-10-30T12:00:00Z"}').inFlight,1);
 const before=fs.readFileSync(path.join(__dirname,'nginx.failover-before.conf'),'utf8'), after=fs.readFileSync(path.join(__dirname,'nginx.failover-after.conf'),'utf8');
 assert.match(before,/proxy_next_upstream off;/);assert.match(after,/zone evolve_api 64k;/);assert.match(after,/proxy_next_upstream_tries 3;/);assert.match(after,/proxy_next_upstream_timeout 5s;/);assert.match(after,/limit_except GET/);assert.doesNotMatch(after,/proxy_next_upstream[^;]*non_idempotent/);
});
