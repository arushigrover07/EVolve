param([string]$ResultDirectory = (Join-Path $PSScriptRoot '../benchmarks/results'))
$ErrorActionPreference = 'Stop'
# The Node validator rechecks every field, raw artifact/hash and current workload/config hashes.
& node (Join-Path $PSScriptRoot '../benchmarks/result-validation.cjs') compare `
    (Join-Path $ResultDirectory 'One.json') (Join-Path $ResultDirectory 'Three.json')
if ($LASTEXITCODE -ne 0) { throw 'Missing, malformed, rejected or incompatible benchmark results.' }
