param(
    [Parameter(Mandatory = $true)][ValidateSet('Start','Cleanup')][string]$Action,
    [string]$ApprovedBackendImage,
    [string]$ApprovedProxyImage,
    [switch]$Execute
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'q1b-runtime.ps1')
if ($Action -eq 'Cleanup') {
    Invoke-Q1bCleanup -ApprovedProxyImage $ApprovedProxyImage -Execute:$Execute
    return
}
$phase = 'BeforeStart'
$receipt = Invoke-Q1bPreflight -Phase $phase -ApprovedBackendImage $ApprovedBackendImage -ApprovedProxyImage $ApprovedProxyImage
if (!$Execute) { Write-Output 'Read-only preflight passed. No container was changed; -Execute requires separate runtime approval.'; return }
# Changes are possible ONLY after successful ownership/port/image checks and explicit -Execute.
$existingImageVariable = [Environment]::GetEnvironmentVariable('Q1B_PROXY_IMAGE', 'Process')
$emptyComposeEnv = New-TemporaryFile
try {
    $env:Q1B_PROXY_IMAGE = $receipt.proxyImage
    $file = Join-Path $PSScriptRoot '../benchmarks/compose.one.yml'
    $arguments = @('compose', '--env-file', $emptyComposeEnv.FullName, '-p', 'evolve-q1b-baseline', '-f', $file)
    $arguments += @('up', '-d', '--no-build', '--pull', 'never')
    & docker @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Baseline operation failed.' }
} finally {
    [Environment]::SetEnvironmentVariable('Q1B_PROXY_IMAGE', $existingImageVariable, 'Process')
    Remove-Item -LiteralPath $emptyComposeEnv.FullName
}
