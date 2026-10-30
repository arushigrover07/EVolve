$ErrorActionPreference = 'Stop'
$emptyBenchmarkEnv = New-TemporaryFile
try {
    function Read-Q1bModel {
        param([string[]]$Files, [string]$Project)
        $arguments = @('compose', '--env-file', $emptyBenchmarkEnv.FullName, '-p', $Project)
        foreach ($file in $Files) { $arguments += @('-f', $file) }
        $arguments += @('config', '--no-env-resolution', '--no-interpolate', '--format', 'json')
        $json = & docker @arguments
        if ($LASTEXITCODE -ne 0) { throw 'Offline benchmark Compose validation failed.' }
        return ($json -join "`n") | ConvertFrom-Json
    }
    $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $one = Read-Q1bModel -Project 'evolve-q1b-baseline' -Files @((Join-Path $root 'benchmarks/compose.one.yml'))
    $proxy = $one.services.'baseline-proxy'
    if ($one.name -cne 'evolve-q1b-baseline' -or @($one.services.PSObject.Properties).Count -ne 1 -or !$proxy) { throw 'Unexpected baseline project/services.' }
    if ($proxy.image -notmatch '^\$\{Q1B_PROXY_IMAGE:' -or $proxy.pull_policy -cne 'never' -or $proxy.build -or $proxy.env_file) { throw 'Baseline requires an approved immutable local image only.' }
    if (@($proxy.ports).Count -ne 1 -or $proxy.ports[0].host_ip -cne '127.0.0.1' -or $proxy.ports[0].published -cne '5174' -or $proxy.ports[0].target -ne 80) { throw 'Unexpected baseline port.' }
    if (!$one.networks.existing.external -or $one.networks.existing.name -cne 'evolve_default') { throw 'Unexpected external network.' }
    if (@($proxy.volumes).Count -ne 1 -or !$proxy.volumes[0].read_only -or $proxy.volumes[0].target -cne '/etc/nginx/conf.d/default.conf' -or $proxy.volumes[0].source -notmatch 'nginx\.one\.conf$') { throw 'Unexpected baseline mount.' }
    $three = Read-Q1bModel -Project 'evolve' -Files @((Join-Path $root 'docker-compose.yml'), (Join-Path $root 'benchmarks/compose.three.override.yml'))
    foreach ($name in @('backend1', 'backend2', 'backend3')) {
        $api = $three.services.$name
        if ($api.image -notmatch '^\$\{Q1B_BACKEND_IMAGE:' -or $api.pull_policy -cne 'never' -or $api.ports -or ($api.command -join ' ') -cne 'node server.js' -or $api.environment.TELEMETRY_ENABLED -cne 'false' -or $api.environment.PG_POOL_MAX -cne '5') { throw 'Unexpected benchmark backend configuration.' }
    }
    if ($three.services.frontend.image -notmatch '^\$\{Q1B_PROXY_IMAGE:' -or !($three.services.frontend.volumes | Where-Object { $_.source -match 'nginx\.three\.conf$' -and $_.read_only })) { throw 'Unexpected benchmark frontend configuration.' }
    if (@($three.services.telemetry.profiles) -notcontains 'telemetry') { throw 'Telemetry is not opt-in.' }
    $rollback = Read-Q1bModel -Project 'evolve' -Files @((Join-Path $root 'docker-compose.yml'), (Join-Path $root 'benchmarks/compose.rollback.yml'))
    foreach ($name in @('backend1','backend2','backend3','frontend')) {
        if ($rollback.services.$name.image -cnotmatch '^sha256:[a-f0-9]{64}$' -or $rollback.services.$name.pull_policy -cne 'never') { throw 'Rollback must pin immutable local image IDs.' }
    }
    $oneConfig = (Get-Content -LiteralPath (Join-Path $root 'benchmarks/nginx.one.conf') -Raw).Replace("`r`n", "`n")
    $threeConfig = (Get-Content -LiteralPath (Join-Path $root 'benchmarks/nginx.three.conf') -Raw).Replace("`r`n", "`n")
    $oneNormalized = [regex]::Replace($oneConfig, '\A#[^\n]*\n', '')
    $threeNormalized = [regex]::Replace($threeConfig, '\A#[^\n]*\n', '').Replace("    server backend2:5000;`n", '').Replace("    server backend3:5000;`n", '')
    if ($oneNormalized -cne $threeNormalized) { throw 'Benchmark proxy settings differ beyond upstream membership.' }
    foreach ($entry in @(@{ text = $oneConfig; servers = 'backend1:5000' }, @{ text = $threeConfig; servers = 'backend1:5000,backend2:5000,backend3:5000' })) {
        $block = [regex]::Match($entry.text, '(?s)upstream evolve_api\s*\{([^}]*)\}')
        $servers = @([regex]::Matches($block.Groups[1].Value, 'server\s+([^;\s]+)\s*;') | ForEach-Object { $_.Groups[1].Value })
        if (!$block.Success -or ($servers -join ',') -cne $entry.servers -or $entry.text -notmatch 'proxy_next_upstream off;' -or $entry.text -notmatch 'proxy_pass http://evolve_api;') { throw 'Unexpected benchmark upstream or retry policy.' }
    }
    Write-Output 'PASS: three Compose models, proxy membership/settings and retry policy validated offline; no environment files resolved.'
} finally { Remove-Item -LiteralPath $emptyBenchmarkEnv.FullName }
