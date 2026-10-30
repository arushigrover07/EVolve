# Pure synthetic-state tests. No Docker calls, sockets, environment mutation or services.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/q1b-runtime.ps1')
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$backendImage = 'sha256:' + ('a' * 64)
$proxyImage = 'sha256:' + ('b' * 64)
$testCount = 0
$runtimeSource = Get-Content -LiteralPath (Join-Path $root 'scripts/q1b-runtime.ps1') -Raw
if ($runtimeSource.Contains('if .State.Health') -or !$runtimeSource.Contains('index .State "Health"')) { throw 'Docker frontend inspection must tolerate missing Health metadata.' }; $testCount++
function New-TestState {
    $stack = @()
    foreach ($service in @('frontend','backend1','backend2','backend3')) {
        $stack += [pscustomobject]@{ id = $service; name = "/evolve-$service-1"; service = $service; project = 'evolve'; running = $true; health = 'healthy'
            image = $(if ($service -eq 'frontend') { $proxyImage } else { $backendImage })
            networks = [pscustomobject]@{ evolve_default = [pscustomobject]@{ Aliases = @($service) } }
            mounts = @([pscustomobject]@{ Type = 'bind'; Destination = '/etc/nginx/conf.d/default.conf'; Source = (Join-Path $root 'benchmarks/nginx.three.conf'); RW = $false })
            ports = [pscustomobject]@{ '80/tcp' = @([pscustomobject]@{ HostIp = '0.0.0.0'; HostPort = '5173' }) }
        }
    }
    return [pscustomobject]@{ stack = $stack; baseline = @(); portFree = $true; protectedIds = @(); portContainerIds = @(); runningServices = @('frontend','backend1','backend2','backend3') }
}
function Add-TestProxy {
    param($State)
    $State.baseline = @([pscustomobject]@{ id = ('9' * 64); name = '/evolve-q1b-baseline-baseline-proxy-1'; service = 'baseline-proxy'; project = 'evolve-q1b-baseline'; running = $true; image = $proxyImage
        networks = [pscustomobject]@{ evolve_default = [pscustomobject]@{} }
        mounts = @([pscustomobject]@{ Type = 'bind'; Destination = '/etc/nginx/conf.d/default.conf'; Source = (Join-Path $root 'benchmarks/nginx.one.conf'); RW = $false })
        ports = [pscustomobject]@{ '80/tcp' = @([pscustomobject]@{ HostIp = '127.0.0.1'; HostPort = '5174' }) }
    })
}
function Assert-TestState {
    param($State, [string]$Phase)
    Assert-Q1bState -State $State -Phase $Phase -ApprovedBackendImage $backendImage -ApprovedProxyImage $proxyImage -RepositoryRoot $root | Out-Null
}
function Expect-Rejection {
    param([scriptblock]$Action)
    $rejected = $false
    try { & $Action } catch { $rejected = $true }
    if (!$rejected) { throw 'Expected preflight rejection.' }
    $script:testCount++
}
Assert-TestState (New-TestState) BeforeStart; $testCount++
foreach ($phase in @('BeforeRun','BeforeCleanup')) { $state = New-TestState; Add-TestProxy $state; Assert-TestState $state $phase; $testCount++ }
Expect-Rejection { $state = New-TestState; $state.portFree = $false; Assert-TestState $state BeforeStart }
Expect-Rejection { $state = New-TestState; Add-TestProxy $state; Assert-TestState $state BeforeStart }
foreach ($mutate in @(
    { param($s) $s.stack[1].image = 'sha256:' + ('c' * 64) },
    { param($s) $s.stack[0].image = 'sha256:' + ('c' * 64) },
    { param($s) $s.stack[1].project = 'unexpected' },
    { param($s) $s.stack[1].running = $false },
    { param($s) $s.stack[1].health = 'unhealthy' },
    { param($s) $s.stack[1].networks.evolve_default.Aliases = @('wrong') },
    { param($s) $s.stack[0].mounts[0].Source = (Join-Path $root 'frontend/nginx.compose.conf') },
    { param($s) $s.stack[0].mounts[0].RW = $true },
    { param($s) $s.runningServices += 'telemetry' },
    { param($s) $s.runningServices += 'backend1' }
)) {
    $state = New-TestState; & $mutate $state
    Expect-Rejection { Assert-TestState $state BeforeStart }
}
foreach ($mutate in @(
    { param($s) $s.baseline[0].project = 'evolve' },
    { param($s) $s.baseline[0].service = 'backend1' },
    { param($s) $s.baseline[0].id = 'backend1' },
    { param($s) $s.baseline[0].image = 'sha256:' + ('c' * 64) },
    { param($s) $s.baseline[0].mounts[0].Source = (Join-Path $root 'frontend/nginx.compose.conf') },
    { param($s) $s.baseline[0].mounts[0].RW = $true },
    { param($s) $s.baseline[0].ports.'80/tcp'[0].HostIp = '0.0.0.0' },
    { param($s) $s.baseline[0].ports.'80/tcp'[0].HostPort = '5173' },
    { param($s) $s.baseline += $s.baseline[0] }
)) {
    foreach ($phase in @('BeforeRun','BeforeCleanup')) {
        $state = New-TestState; Add-TestProxy $state; & $mutate $state
        Expect-Rejection { Assert-TestState $state $phase }
    }
}
Assert-Q1bEnvironment -Names @('PATH'); $testCount++
Expect-Rejection { Assert-Q1bEnvironment -Names @('PATH','K6_VUS') }
Expect-Rejection { Assert-Q1bEnvironment -Names @('K6_SCENARIOS') }
# Recovery states must not weaken startup or benchmark execution checks.
foreach ($mutate in @(
    { param($s) $s.stack[1].health = 'unhealthy' },
    { param($s) $s.stack[1].running = $false; $s.runningServices = @() },
    { param($s) $s.stack[2].image = 'sha256:' + ('c' * 64) },
    { param($s) $s.stack[0].running = $false },
    { param($s) $s.stack = @(); $s.runningServices = @() },
    { param($s) $s.stack[2].image = 'sha256:' + ('c' * 64); $s.stack[3].image = 'sha256:' + ('d' * 64); $s.stack[0].mounts[0].Source = (Join-Path $root 'frontend/nginx.compose.conf') }
)) {
    $state = New-TestState; Add-TestProxy $state; & $mutate $state
    Assert-TestState $state BeforeCleanup; $testCount++
    Expect-Rejection { Assert-TestState $state BeforeRun }
}
$state = New-TestState; $state.stack = @(); $state.runningServices = @()
$receipt = Assert-Q1bState -State $state -Phase BeforeCleanup -RepositoryRoot $root
if (!$receipt.absent) { throw 'Missing baseline must be a no-op without original stack/image approvals.' }; $testCount++
foreach ($mutate in @(
    { param($s) $s.baseline[0].mounts[0].Type = 'volume' },
    { param($s) $s.baseline[0].networks = [pscustomobject]@{ wrong = [pscustomobject]@{} } },
    { param($s) $s.baseline[0].networks | Add-Member -NotePropertyName extra -NotePropertyValue ([pscustomobject]@{}) },
    { param($s) $s.protectedIds = @($s.baseline[0].id) },
    { param($s) $s.stack[1].id = $s.baseline[0].id },
    { param($s) $s.portContainerIds = @('8' * 64) },
    { param($s) $s.baseline[0].name = '/evolve-backend1-1' }
)) {
    $state = New-TestState; Add-TestProxy $state; & $mutate $state
    Expect-Rejection { Assert-TestState $state BeforeCleanup }
}
$originalCleanupPreflight = ${function:Invoke-Q1bPreflight}
# Exercise the actual cleanup dispatcher with mocks. The docker function captures
# arguments only: these tests can never invoke Docker's executable or a live rm.
$script:cleanupCalls = [Collections.Generic.List[object]]::new()
$script:cleanupStates = @()
$script:cleanupIndex = 0
$script:cleanupConfig = Get-Content -LiteralPath (Join-Path $root 'benchmarks/nginx.one.conf') -Raw
function Invoke-Q1bPreflight {
    param([string]$Phase, [string]$ApprovedBackendImage, [string]$ApprovedProxyImage)
    if ($Phase -cne 'BeforeCleanup') { throw 'Unexpected mocked phase.' }
    $state = $script:cleanupStates[[Math]::Min($script:cleanupIndex, $script:cleanupStates.Count - 1)]
    $script:cleanupIndex++
    $receipt = Assert-Q1bState -State $state -Phase BeforeCleanup -ApprovedProxyImage $ApprovedProxyImage -RepositoryRoot $root
    if (!$receipt.absent) { Assert-Q1bCleanupConfig -Text $script:cleanupConfig }
    return $receipt
}
function docker {
    $script:cleanupCalls.Add(@($args))
    $global:LASTEXITCODE = 0
}
if ((Get-Command docker).CommandType -ne 'Function') { throw 'Docker mock is not installed; refusing action tests.' }
function Set-CleanupTestStates {
    param([object[]]$States)
    $script:cleanupStates = $States; $script:cleanupIndex = 0; $script:cleanupCalls.Clear()
}
function Assert-NoRemoval { if ($script:cleanupCalls.Count -ne 0) { throw 'Removal occurred before validation.' } }
$absent = New-TestState; $absent.stack = @(); $absent.runningServices = @()
Set-CleanupTestStates @($absent)
Invoke-Q1bCleanup -Execute | Out-Null; Assert-NoRemoval; $testCount++
$valid = New-TestState; Add-TestProxy $valid
Set-CleanupTestStates @($valid)
Invoke-Q1bCleanup -ApprovedProxyImage $proxyImage | Out-Null; Assert-NoRemoval; $testCount++
Set-CleanupTestStates @($valid)
Invoke-Q1bCleanup -ApprovedProxyImage $proxyImage -Execute | Out-Null
if ($script:cleanupCalls.Count -ne 1 -or ($script:cleanupCalls[0] -join ' ') -cne ('container rm --force ' + ('9' * 64)) -or $script:cleanupIndex -ne 2) { throw 'Cleanup must revalidate and remove exactly the verified full ID.' }; $testCount++
foreach ($mutate in @(
    { param($s) $s.baseline[0].image = 'sha256:' + ('c' * 64) },
    { param($s) $s.baseline[0].project = 'evolve' },
    { param($s) $s.baseline[0].service = 'backend1' },
    { param($s) $s.baseline[0].mounts[0].RW = $true },
    { param($s) $s.baseline[0].networks = [pscustomobject]@{ wrong = [pscustomobject]@{} } },
    { param($s) $s.protectedIds = @($s.baseline[0].id) }
)) {
    $invalid = New-TestState; Add-TestProxy $invalid; & $mutate $invalid
    Set-CleanupTestStates @($invalid)
    Expect-Rejection { Invoke-Q1bCleanup -ApprovedProxyImage $proxyImage -Execute | Out-Null }; Assert-NoRemoval
}
$replacement = New-TestState; Add-TestProxy $replacement; $replacement.baseline[0].id = '8' * 64
Set-CleanupTestStates @($valid, $replacement)
Expect-Rejection { Invoke-Q1bCleanup -ApprovedProxyImage $proxyImage -Execute | Out-Null }; Assert-NoRemoval
Set-CleanupTestStates @($valid, $absent)
Invoke-Q1bCleanup -ApprovedProxyImage $proxyImage -Execute | Out-Null; Assert-NoRemoval; $testCount++
Set-CleanupTestStates @($valid)
$savedConfig = $script:cleanupConfig; $script:cleanupConfig = 'upstream evolve_api { server backend2:5000; }'
Expect-Rejection { Invoke-Q1bCleanup -ApprovedProxyImage $proxyImage -Execute | Out-Null }; Assert-NoRemoval
$script:cleanupConfig = $savedConfig
$stopped = New-TestState; Add-TestProxy $stopped; $stopped.baseline[0].running = $false; $stopped.stack = @()
Set-CleanupTestStates @($stopped)
Invoke-Q1bCleanup -ApprovedProxyImage $proxyImage -Execute | Out-Null
if ($script:cleanupCalls.Count -ne 1) { throw 'Stopped baseline with missing originals should be removable.' }; $testCount++
$manager = Get-Content -LiteralPath (Join-Path $root 'scripts/manage-q1b-baseline.ps1') -Raw
if ($manager -match "@\('down'\)" -or $manager -notmatch 'Invoke-Q1bCleanup' -or $manager -notmatch "'evolve-q1b-baseline'") { throw 'Manager cleanup routing/project safety changed.' }; $testCount++
# Exercise the real cleanup collector/preflight using a read-only Docker mock.
# Missing original containers never cause an inspect of their names.
$script:readCalls = [Collections.Generic.List[object]]::new()
$script:collectorMode = 'absent'
$script:collectorProxy = (New-TestState); Add-TestProxy $script:collectorProxy
function Invoke-Q1bDocker {
    param([string[]]$Arguments)
    $script:readCalls.Add($Arguments)
    if ($Arguments[0] -eq 'inspect') {
        if ($Arguments[-1] -cne ('9' * 64)) { throw 'Cleanup unexpectedly inspected an original container.' }
        $proxy = $script:collectorProxy.baseline[0]
        return $proxy | ConvertTo-Json -Depth 20 -Compress
    }
    if ($Arguments[0] -cne 'ps') { throw 'Cleanup collector attempted a non-read-only Docker command.' }
    $filter = $Arguments[-1]
    if ($filter -eq 'label=com.docker.compose.project=evolve-q1b-baseline') { if ($script:collectorMode -ne 'absent' -and $script:collectorMode -ne 'wrong-project') { return ('9' * 64) }; return }
    if ($filter -eq 'name=^/evolve-q1b-baseline-baseline-proxy-1$') { if ($script:collectorMode -ne 'absent') { return ('9' * 64) }; return }
    if ($filter -eq 'label=com.docker.compose.project=evolve') { return }
    if ($filter -eq 'publish=5174') { if ($script:collectorMode -eq 'foreign-port') { return ('8' * 64) }; return }
    throw 'Unexpected Docker read.'
}
$receipt = & $originalCleanupPreflight -Phase BeforeCleanup
if (!$receipt.absent -or $script:readCalls.Count -ne 2) { throw 'Absent cleanup should inspect only baseline inventory.' }; $testCount++
$script:collectorMode = 'present'; $script:readCalls.Clear()
$receipt = & $originalCleanupPreflight -Phase BeforeCleanup -ApprovedProxyImage $proxyImage
if ($receipt.containerId -cne ('9' * 64) -or @($script:readCalls | Where-Object { $_[0] -eq 'inspect' -and $_[-1] -cne ('9' * 64) }).Count) { throw 'Recovery cleanup depends on original container inspection.' }; $testCount++
$script:collectorMode = 'wrong-project'; $script:collectorProxy.baseline[0].project = 'evolve'
Expect-Rejection { & $originalCleanupPreflight -Phase BeforeCleanup -ApprovedProxyImage $proxyImage | Out-Null }
$script:collectorProxy.baseline[0].project = 'evolve-q1b-baseline'; $script:collectorMode = 'foreign-port'
Expect-Rejection { & $originalCleanupPreflight -Phase BeforeCleanup -ApprovedProxyImage $proxyImage | Out-Null }
Expect-Rejection { Assert-Q1bState -State (New-TestState) -Phase BeforeStart -ApprovedProxyImage $proxyImage -RepositoryRoot $root | Out-Null }
Write-Output "PASS: $testCount synthetic preflight, recovery and mocked cleanup checks. No real Docker or HTTP calls made."
