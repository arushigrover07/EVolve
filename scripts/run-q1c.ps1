param(
    [Parameter(Mandatory = $true)][ValidateSet('Before','After')][string]$Phase,
    [Parameter(Mandatory = $true)][string]$ApprovedBackendImage,
    [Parameter(Mandatory = $true)][string]$ApprovedProxyImage,
    [string]$K6Path = 'k6',
    [string]$ResultDirectory = (Join-Path $PSScriptRoot '../docs/da3/q1/benchmarks/failure'),
    [switch]$Run
)
$ErrorActionPreference = 'Stop'
if (!$Run) { throw 'Failure experiment requires explicit -Run and validated recovery scope.' }
. (Join-Path $PSScriptRoot 'q1b-runtime.ps1')
Assert-Q1bEnvironment
if (Get-Process -Name k6,hey,ab -ErrorAction SilentlyContinue) { throw 'Another load tool is running; do not stop a backend.' }
$state = Get-Q1bState
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$frontend = @($state.stack | Where-Object { $_.service -eq 'frontend' })[0]
$expectedConfig = Join-Path $root ('benchmarks/nginx.failover-{0}.conf' -f $Phase.ToLowerInvariant())
if ($frontend.image -cne $ApprovedProxyImage -or @($state.baseline).Count -ne 0) { throw 'Unexpected proxy image or baseline project during failure test.' }
$mount = @($frontend.mounts | Where-Object { $_.Destination -eq '/etc/nginx/conf.d/default.conf' })
if ($mount.Count -ne 1 -or $mount[0].RW -ne $false -or (Convert-Q1bMountPath $mount[0].Source) -cne (Convert-Q1bMountPath $expectedConfig)) { throw 'Wrong failure-phase Nginx mount.' }
# Independent failure-test scope; Q1(b) alignment/startup validation is unchanged.
if (@($state.stack).Count -ne 4 -or (@($state.runningServices | Sort-Object) -join ',') -cne 'backend1,backend2,backend3,frontend') { throw 'Unexpected running stack or extra service.' }
foreach ($service in @('frontend','backend1','backend2','backend3')) {
    $items = @($state.stack | Where-Object { $_.service -ceq $service })
    if ($items.Count -ne 1) { throw 'Ambiguous service ownership.' }
    $item = $items[0]
    if ($item.project -cne 'evolve' -or $item.name -cne "/evolve-$service-1" -or !$item.running -or !$item.networks.evolve_default -or $item.id -cnotmatch '^[a-f0-9]{64}$') { throw 'Service identity or network mismatch.' }
    if ($service -ne 'frontend' -and ($item.image -cne $ApprovedBackendImage -or $item.health -cne 'healthy' -or $item.ports -and @($item.ports.PSObject.Properties).Count -gt 0 -or @($item.networks.evolve_default.Aliases) -cnotcontains $service)) { throw 'Backend image, health, alias or published-port mismatch.' }
}
if ($ApprovedBackendImage -cnotmatch '^sha256:[a-f0-9]{64}$' -or $ApprovedProxyImage -cnotmatch '^sha256:[a-f0-9]{64}$') { throw 'Approved immutable image IDs are required.' }
if (@($frontend.ports.'80/tcp' | Where-Object { $_.HostPort -eq '5173' }).Count -lt 1) { throw 'Unexpected proxy port.' }
# Require a quiet proxy before starting; only sanitized access entries are inspected.
$recent = & docker logs --since 3s $frontend.id 2>&1
if ($LASTEXITCODE -ne 0 -or @($recent | Where-Object { "$_" -match 'method=' }).Count) { throw 'Proxy traffic is active or cannot be inspected; wait for an isolated test window.' }
$ready = try { Invoke-WebRequest -Uri 'http://127.0.0.1:5173/api/stations' -TimeoutSec 20 -UseBasicParsing } catch { if ($_.Exception.Response) { $_.Exception.Response } else { throw } }
if ($ready.StatusCode -ne 200) { throw 'Failure test blocked: station API is not ready; no backend stopped.' }
$tool = Get-Command $K6Path -CommandType Application -ErrorAction Stop
$version = (& $tool.Source version | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify k6.' }
$target = @($state.stack | Where-Object { $_.service -eq 'backend3' })[0]
if ($target.id -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid exact stop target.' }
$directory = [IO.Path]::GetFullPath($ResultDirectory)
foreach ($suffix in @('raw.json','requests.log','meta.json','result.json','stdout.txt','stderr.txt')) { if (Test-Path (Join-Path $directory "$Phase.$suffix")) { throw 'Failure artifacts already exist; no overwrite.' } }
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$rawFile = Join-Path $directory "$Phase.raw.json"; $logFile = Join-Path $directory "$Phase.requests.log"
$metadata = [ordered]@{ phase=$Phase; endpoint='http://127.0.0.1:5173/api/stations'; requestCount=1000; concurrency=20; timeoutSeconds=20; pacingSeconds=0.5; stopDelaySeconds=8; backendImage=$ApprovedBackendImage; proxyImage=$ApprovedProxyImage; targetService='backend3'; targetContainerId=$target.id; toolVersion=$version; toolSha256=(Get-FileHash $tool.Source -Algorithm SHA256).Hash; workloadSha256=(Get-FileHash (Join-Path $root 'benchmarks/q1c.mjs') -Algorithm SHA256).Hash.ToLowerInvariant(); proxyConfigSha256=(Get-FileHash $expectedConfig -Algorithm SHA256).Hash.ToLowerInvariant(); dataBeforeSha256=[BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($ready.Content))).Replace("-","").ToLowerInvariant(); dataAfterSha256=$null; processExitCode=-1; recoverySucceeded=$false; stopRequestedAt=$null; stopCompletedAt=$null; observedInFlight=0 }
$emptyConfig = New-TemporaryFile; [IO.File]::WriteAllText($emptyConfig.FullName, '{}')
$process = [Diagnostics.Process]::new(); $process.StartInfo = [Diagnostics.ProcessStartInfo]::new($tool.Source)
$process.StartInfo.UseShellExecute=$false; $process.StartInfo.RedirectStandardOutput=$true; $process.StartInfo.RedirectStandardError=$true
$argsList = @('run','--config',$emptyConfig.FullName,'--no-usage-report','--include-system-env-vars=false','--log-format','raw','--console-output',$logFile,'--env',"PHASE=$Phase",'--env',"RAW_SUMMARY_FILE=$rawFile",(Join-Path $root 'benchmarks/q1c.mjs'))
if ($null -ne $process.StartInfo.ArgumentList) {
    foreach ($argument in $argsList) { $process.StartInfo.ArgumentList.Add($argument) }
} else {
    $process.StartInfo.Arguments = ($argsList | ForEach-Object { if ($_ -match '[\s"]') { '"{0}"' -f ($_ -replace '"', '\"') } else { $_ } }) -join ' '
}
$stopAttempted=$false; $processStarted=$false
try {
    if (!$process.Start()) { throw 'k6 did not start; no backend stopped.' }
    $processStarted=$true
    $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
    while (!$process.HasExited) {
        $json = & node (Join-Path $root 'benchmarks/failure-validation.cjs') progress $logFile
        if ($LASTEXITCODE -ne 0) { throw 'Cannot observe active load; no fault is authorized.' }
        $progress = $json | ConvertFrom-Json
        if (!$stopAttempted -and $progress.firstRequestAt -and ([DateTimeOffset]::UtcNow - ([DateTimeOffset]$progress.firstRequestAt)).TotalSeconds -ge 8 -and $progress.inFlight -gt 0) {
            $loadProcesses = @(Get-Process -Name k6 -ErrorAction SilentlyContinue)
            if ($loadProcesses.Count -ne 1 -or $loadProcesses[0].Id -ne $process.Id -or (Get-Process -Name hey,ab -ErrorAction SilentlyContinue)) { throw 'Concurrent/unexpected k6 process; stop cancelled.' }
            $identity = & docker inspect --format '{{.Id}}|{{.Image}}|{{index .Config.Labels `com.docker.compose.project`}}|{{index .Config.Labels `com.docker.compose.service`}}|{{.State.Running}}' $target.id
            if ($LASTEXITCODE -ne 0 -or $identity -cne ($target.id+'|'+$ApprovedBackendImage+'|evolve|backend3|true')) { throw 'Stop target identity changed.' }
            $metadata.observedInFlight=$progress.inFlight; $metadata.stopRequestedAt=[DateTimeOffset]::UtcNow.ToString('o'); $stopAttempted=$true
            & docker stop --time 15 $target.id | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Exact backend stop failed.' }
            $metadata.stopCompletedAt=[DateTimeOffset]::UtcNow.ToString('o')
        }
        Start-Sleep -Milliseconds 100
    }
    $metadata.processExitCode=$process.ExitCode
    [IO.File]::WriteAllText((Join-Path $directory "$Phase.stdout.txt"),$stdout.GetAwaiter().GetResult())
    [IO.File]::WriteAllText((Join-Path $directory "$Phase.stderr.txt"),$stderr.GetAwaiter().GetResult())
    if (!$stopAttempted) { throw 'Load ended before a verifiable in-flight stop event.' }
} finally {
    try {
        if ($processStarted -and !$process.HasExited) { $process.Kill(); $process.WaitForExit() }
        if ($stopAttempted) {
            $identity = & docker inspect --format '{{.Id}}|{{.Image}}|{{index .Config.Labels `com.docker.compose.project`}}|{{index .Config.Labels `com.docker.compose.service`}}' $target.id
            if ($LASTEXITCODE -ne 0 -or $identity -cne ($target.id+'|'+$ApprovedBackendImage+'|evolve|backend3')) { throw 'Recovery target changed; refusing any broader recovery operation.' }
            & docker start $target.id | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Exact backend restoration failed.' }
            $deadline=[DateTimeOffset]::UtcNow.AddSeconds(60)
            do { $health=& docker inspect --format '{{if (index .State `Health`)}}{{json (index (index .State `Health`) `Status`)}}{{else}}null{{end}}' $target.id; if ($health -eq '"healthy"') { $metadata.recoverySucceeded=$true; break }; Start-Sleep -Seconds 1 } while ([DateTimeOffset]::UtcNow -lt $deadline)
        }
    } finally {
        if ($processStarted) {
            [IO.File]::WriteAllText((Join-Path $directory "$Phase.stdout.txt"),$stdout.GetAwaiter().GetResult())
            [IO.File]::WriteAllText((Join-Path $directory "$Phase.stderr.txt"),$stderr.GetAwaiter().GetResult())
        }
        Remove-Item -LiteralPath $emptyConfig.FullName
        if ($metadata.recoverySucceeded) {
            try { $after=try { Invoke-WebRequest -Uri 'http://127.0.0.1:5173/api/stations' -TimeoutSec 20 -UseBasicParsing } catch { if ($_.Exception.Response) { $_.Exception.Response } else { throw } }; if ($after.StatusCode -eq 200) { $metadata.dataAfterSha256=[BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($after.Content))).Replace("-","").ToLowerInvariant() } } catch { $metadata.dataAfterSha256=$null }
        }
        [IO.File]::WriteAllText((Join-Path $directory "$Phase.meta.json"),($metadata|ConvertTo-Json -Depth 20))
    }
}

$result = & node (Join-Path $root 'benchmarks/failure-validation.cjs') validate $rawFile $logFile (Join-Path $directory "$Phase.meta.json")
if ($LASTEXITCODE -ne 0) { throw 'Failure evidence invalid or incomplete; no successful failover claim.' }
$result | Set-Content (Join-Path $directory "$Phase.result.json") -Encoding utf8
Write-Output "$Phase experiment completed; inspect actual counts before drawing conclusions."
