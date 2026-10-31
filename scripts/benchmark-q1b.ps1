param(
    [Parameter(Mandatory = $true)][ValidateSet('One', 'Three')][string]$Configuration,
    [Parameter(Mandatory = $true)][string]$ApprovedBackendImage,
    [Parameter(Mandatory = $true)][string]$ApprovedProxyImage,
    [string]$K6Path = 'k6',
    [string]$ResultDirectory = (Join-Path $PSScriptRoot '../benchmarks/results'),
    [switch]$Run
)
$ErrorActionPreference = 'Stop'
if (!$Run) { throw 'Preparation only. Add -Run only after benchmark and database-read approval.' }
. (Join-Path $PSScriptRoot 'q1b-runtime.ps1')
Assert-Q1bEnvironment
$receipt = Invoke-Q1bPreflight -Phase BeforeRun -ApprovedBackendImage $ApprovedBackendImage -ApprovedProxyImage $ApprovedProxyImage
# A live process is insufficient. These unmeasured read-only snapshot requests
# bracket the 1000 measured requests; no warm-up workload is added.
$endpoint = if ($Configuration -eq 'One') { 'http://127.0.0.1:5174/api/stations' } else { 'http://127.0.0.1:5173/api/stations' }
$readiness = try { Invoke-WebRequest -Uri $endpoint -TimeoutSec 20 -UseBasicParsing } catch { if ($_.Exception.Response) { $_.Exception.Response } else { throw } }
if ($readiness.StatusCode -ne 200) { throw 'Benchmark blocked: the read-only station API is not ready. No measured workload started.' }
try { $null = $readiness.Content | ConvertFrom-Json } catch { throw 'Benchmark blocked: station API returned invalid JSON.' }
$dataBefore = [BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($readiness.Content))).Replace("-","").ToLowerInvariant()
$tool = Get-Command $K6Path -CommandType Application -ErrorAction Stop
$version = (& $tool.Source version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $version -cnotmatch '^k6(?:\.exe)? v[0-9]+\.[0-9]+\.[0-9]+[^\r\n]*$') { throw 'Cannot determine k6 version.' }
$toolHash = (Get-FileHash -LiteralPath $tool.Source -Algorithm SHA256).Hash.ToLowerInvariant()
$resultDir = [IO.Path]::GetFullPath($ResultDirectory)
$resultFile = Join-Path $resultDir "$Configuration.json"
$rawFile = Join-Path $resultDir "$Configuration.raw.json"
$metaFile = Join-Path $resultDir "$Configuration.meta.json"
$consoleFile = Join-Path $resultDir "$Configuration.console.txt"
foreach ($file in @($resultFile, $rawFile, $metaFile, $consoleFile)) { if (Test-Path -LiteralPath $file) { throw 'Run artifacts already exist; preserve them rather than overwriting.' } }
$scriptFile = Join-Path $PSScriptRoot '../benchmarks/q1b.mjs'
$proxyFile = Join-Path $PSScriptRoot ("../benchmarks/nginx.{0}.conf" -f $Configuration.ToLowerInvariant())
$endpoint = if ($Configuration -eq 'One') { 'http://127.0.0.1:5174/api/stations' } else { 'http://127.0.0.1:5173/api/stations' }
$metadata = [ordered]@{
    configuration = $Configuration; endpoint = $endpoint; toolName = 'k6'; toolVersion = $version
    toolSha256 = $toolHash; runId = [Guid]::NewGuid().ToString(); processExitCode = -1
    workloadSha256 = (Get-FileHash -LiteralPath $scriptFile -Algorithm SHA256).Hash.ToLowerInvariant()
    proxyConfigSha256 = (Get-FileHash -LiteralPath $proxyFile -Algorithm SHA256).Hash.ToLowerInvariant()
    backendImage = $receipt.backendImage; proxyImage = $receipt.proxyImage; backendImages = $receipt.backendImages
    dataBeforeSha256 = $dataBefore; dataAfterSha256 = $null; warmupRequests = 0
}
New-Item -ItemType Directory -Path $resultDir -Force | Out-Null
# An explicit empty config avoids ambient user configuration. K6_* vars were rejected above.
$emptyK6Config = New-TemporaryFile
try {
    [IO.File]::WriteAllText($emptyK6Config.FullName, '{}')
    try {
        & $tool.Source run --config $emptyK6Config.FullName --no-usage-report --include-system-env-vars=false `
            --env "CONFIGURATION=$Configuration" --env "RAW_SUMMARY_FILE=$rawFile" $scriptFile 2>&1 | Tee-Object -FilePath $consoleFile
        $metadata.processExitCode = $LASTEXITCODE
    } catch { $metadata.processExitCode = -1 }
} finally { Remove-Item -LiteralPath $emptyK6Config.FullName }
try {
    $after = try { Invoke-WebRequest -Uri $endpoint -TimeoutSec 20 -UseBasicParsing } catch { if ($_.Exception.Response) { $_.Exception.Response } else { throw } }
    if ($after.StatusCode -eq 200) { $metadata.dataAfterSha256 = [BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($after.Content))).Replace("-","").ToLowerInvariant() }
} catch { $metadata.dataAfterSha256 = $null }
# Persist even a failed process exit. Raw k6 output never marks itself accepted.
[IO.File]::WriteAllText($metaFile, ($metadata | ConvertTo-Json -Depth 20))
& node (Join-Path $PSScriptRoot '../benchmarks/result-validation.cjs') finalize $metaFile $rawFile $resultFile
if ($LASTEXITCODE -ne 0) { throw 'Run rejected; raw evidence, exit code and rejected status are preserved.' }
Write-Output "Accepted $Configuration run; use the independent comparator after both runs."
