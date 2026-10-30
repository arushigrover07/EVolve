# Shared read-only runtime checks. Dot-sourcing defines functions only.
function Invoke-Q1bDocker {
    param([string[]]$Arguments)
    $output = & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Read-only Docker inspection failed.' }
    return $output
}
function Convert-Q1bMountPath {
    param([string]$Value)
    $valueNormalized = $Value.Replace('\', '/')
    if ($valueNormalized -match '^/(?:run/desktop/mnt/host|host_mnt)/([a-z])/(.*)$') { $valueNormalized = $Matches[1] + ':/' + $Matches[2] }
    return $valueNormalized.TrimEnd('/').ToLowerInvariant()
}
function Assert-Q1bEnvironment {
    param([string[]]$Names = @(Get-ChildItem Env: | ForEach-Object { $_.Name }))
    # This also rejects K6_* options; --include-system-env-vars=false alone does not.
    if (@($Names | Where-Object { $_ -match '^K6_' }).Count -gt 0) { throw 'Conflicting inherited K6_* environment variables: use a clean benchmark shell. Values are not displayed.' }
}
function Get-Q1bState {
    param([switch]$CheckPort)
    $template = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},"health":{{if (index .State "Health")}}{{json (index (index .State "Health") "Status")}}{{else}}null{{end}},"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}},"ports":{{json .HostConfig.PortBindings}}}'
    $stack = @()
    foreach ($name in @('evolve-frontend-1', 'evolve-backend1-1', 'evolve-backend2-1', 'evolve-backend3-1')) {
        $stack += ((Invoke-Q1bDocker -Arguments @('inspect', '--format', $template, $name)) | ConvertFrom-Json)
    }
    $baseline = @()
    $ids = @(Invoke-Q1bDocker -Arguments @('ps', '-aq', '--filter', 'label=com.docker.compose.project=evolve-q1b-baseline'))
    foreach ($id in $ids) {
        if ($id) { $baseline += ((Invoke-Q1bDocker -Arguments @('inspect', '--format', $template, $id)) | ConvertFrom-Json) }
    }
    $runningServices = @(Invoke-Q1bDocker -Arguments @('ps', '--filter', 'label=com.docker.compose.project=evolve', '--format', '{{.Label "com.docker.compose.service"}}'))
    $portFree = $null
    if ($CheckPort) {
        # Bind locally and immediately release; sends no HTTP or database request.
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 5174)
        try { $listener.Start(); $portFree = $true } catch { $portFree = $false } finally { $listener.Stop() }
    }
    return [pscustomobject]@{ stack = $stack; baseline = $baseline; portFree = $portFree; runningServices = $runningServices }
}
# Cleanup deliberately does not inspect or depend on original application health/images.
function Get-Q1bCleanupState {
    $template = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}},"ports":{{json .HostConfig.PortBindings}}}'
    $projectIds = @(Invoke-Q1bDocker -Arguments @('ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=evolve-q1b-baseline'))
    # A reserved-name collision with wrong labels must be rejected, not treated as absent.
    $nameIds = @(Invoke-Q1bDocker -Arguments @('ps', '-aq', '--no-trunc', '--filter', 'name=^/evolve-q1b-baseline-baseline-proxy-1$'))
    $ids = @(($projectIds + $nameIds) | Where-Object { $_ } | Sort-Object -Unique)
    $baseline = @()
    foreach ($id in $ids) {
        $baseline += ((Invoke-Q1bDocker -Arguments @('inspect', '--format', $template, $id)) | ConvertFrom-Json)
    }
    $protectedIds = @()
    $portContainerIds = @()
    if ($ids.Count -gt 0) {
        $protectedIds = @(Invoke-Q1bDocker -Arguments @('ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=evolve'))
        $portContainerIds = @(Invoke-Q1bDocker -Arguments @('ps', '-q', '--no-trunc', '--filter', 'publish=5174'))
    }
    return [pscustomobject]@{ baseline = $baseline; protectedIds = $protectedIds; portContainerIds = $portContainerIds }
}
function Assert-Q1bCleanupConfig {
    param([string]$Text)
    $blocks = [regex]::Matches($Text, '(?s)upstream evolve_api\s*\{([^}]*)\}')
    if ($blocks.Count -ne 1) { throw 'Cleanup refused: ambiguous baseline Nginx upstream.' }
    $servers = @([regex]::Matches($blocks[0].Groups[1].Value, 'server\s+([^;\s]+)\s*;') | ForEach-Object { $_.Groups[1].Value })
    if ($servers.Count -ne 1 -or $servers[0] -cne 'backend1:5000' -or $Text -notmatch 'proxy_next_upstream off;' -or $Text -notmatch 'proxy_pass http://evolve_api;') { throw 'Cleanup refused: unexpected benchmark-only Nginx configuration.' }
}
function Assert-Q1bCleanupState {
    param($State, [string]$ApprovedProxyImage, [string]$RepositoryRoot)
    $candidates = @($State.baseline | Where-Object { $null -ne $_ })
    if ($candidates.Count -eq 0) { return [pscustomobject]@{ absent = $true; containerId = $null } }
    if ($candidates.Count -ne 1) { throw 'Cleanup refused: ambiguous dedicated baseline project.' }
    if ($ApprovedProxyImage -cnotmatch '^sha256:[a-f0-9]{64}$') { throw 'Cleanup refused: an approved immutable baseline proxy image ID is required.' }
    $proxy = $candidates[0]
    if ($proxy.id -cnotmatch '^[a-f0-9]{64}$' -or $proxy.project -cne 'evolve-q1b-baseline' -or $proxy.service -cne 'baseline-proxy' -or $proxy.name -cne '/evolve-q1b-baseline-baseline-proxy-1' -or $proxy.image -cne $ApprovedProxyImage) { throw 'Cleanup refused: baseline container identity, ownership or image mismatch.' }
    $protected = @($State.protectedIds) + @($State.stack | ForEach-Object { $_.id })
    if ($protected -ccontains $proxy.id) { throw 'Cleanup refused: target overlaps an original application container.' }
    if (@($State.portContainerIds | Where-Object { $_ -and $_ -cne $proxy.id }).Count) { throw 'Cleanup refused: Docker port 5174 ownership is ambiguous.' }
    if (@($proxy.networks.PSObject.Properties).Count -ne 1 -or !$proxy.networks.evolve_default) { throw 'Cleanup refused: unexpected baseline network attachment.' }
    $mounts = @($proxy.mounts)
    $expected = Convert-Q1bMountPath (Join-Path $RepositoryRoot 'benchmarks/nginx.one.conf')
    if ($mounts.Count -ne 1 -or $mounts[0].Type -cne 'bind' -or $mounts[0].Destination -cne '/etc/nginx/conf.d/default.conf' -or $mounts[0].RW -ne $false -or (Convert-Q1bMountPath $mounts[0].Source) -cne $expected) { throw 'Cleanup refused: unexpected baseline Nginx bind mount.' }
    $ports = @($proxy.ports.'80/tcp')
    if (@($proxy.ports.PSObject.Properties).Count -ne 1 -or $ports.Count -ne 1 -or $ports[0].HostIp -cne '127.0.0.1' -or $ports[0].HostPort -cne '5174') { throw 'Cleanup refused: unexpected baseline port mapping.' }
    return [pscustomobject]@{ absent = $false; containerId = $proxy.id; proxyImage = $proxy.image }
}
function Invoke-Q1bCleanup {
    param([string]$ApprovedProxyImage, [switch]$Execute)
    $receipt = Invoke-Q1bPreflight -Phase BeforeCleanup -ApprovedProxyImage $ApprovedProxyImage
    if ($receipt.absent) { Write-Output 'Baseline absent; nothing needed removal.'; return }
    if (!$Execute) { Write-Output 'Cleanup checks passed; no container removed. Separate approval and -Execute are required.'; return }
    # Re-inspect immediately before deletion; never follow a replaced container name.
    $confirmed = Invoke-Q1bPreflight -Phase BeforeCleanup -ApprovedProxyImage $ApprovedProxyImage
    if ($confirmed.absent) { Write-Output 'Baseline became absent; nothing needed removal.'; return }
    if ($confirmed.containerId -cne $receipt.containerId) { throw 'Cleanup refused: baseline container identity changed during validation.' }
    & docker container rm --force $confirmed.containerId
    if ($LASTEXITCODE -ne 0) { throw 'Exact-container baseline removal failed; no broader cleanup was attempted.' }
    Write-Output 'Verified dedicated baseline proxy removed. Other containers, networks, volumes and images were preserved.'
}
function Assert-Q1bState {
    param($State, [ValidateSet('BeforeStart','BeforeRun','BeforeCleanup')][string]$Phase,
        [string]$ApprovedBackendImage, [string]$ApprovedProxyImage, [string]$RepositoryRoot)
    if ($Phase -eq 'BeforeCleanup') { return Assert-Q1bCleanupState -State $State -ApprovedProxyImage $ApprovedProxyImage -RepositoryRoot $RepositoryRoot }
    foreach ($image in @($ApprovedBackendImage, $ApprovedProxyImage)) {
        if ($image -cnotmatch '^sha256:[a-f0-9]{64}$') { throw 'An explicitly approved immutable image ID is required.' }
    }
    if (@($State.stack).Count -ne 4) { throw 'Unexpected original stack.' }
    $expectedNames = @('frontend', 'backend1', 'backend2', 'backend3')
    if ((@($State.runningServices | Sort-Object) -join ',') -cne (@($expectedNames | Sort-Object) -join ',')) { throw 'Unexpected extra running API, worker or other service in the original project.' }
    foreach ($service in $expectedNames) {
        $matchesService = @($State.stack | Where-Object { $_.service -ceq $service })
        if ($matchesService.Count -ne 1) { throw 'Unexpected original service identity.' }
        $container = $matchesService[0]
        if ($container.project -cne 'evolve' -or $container.name -cne "/evolve-$service-1" -or $container.running -ne $true -or !$container.networks.evolve_default) { throw 'Original stack ownership, state or network mismatch.' }
        if ($service -ne 'frontend') {
            if ($container.image -cne $ApprovedBackendImage -or $container.health -cne 'healthy' -or @($container.networks.evolve_default.Aliases) -cnotcontains $service) { throw 'Backend immutable image, liveness or network alias mismatch.' }
        } else {
            if ($container.image -cne $ApprovedProxyImage) { throw 'Frontend image mismatch.' }
            if ($Phase -ne 'BeforeCleanup') {
                $mount = @($container.mounts | Where-Object { $_.Destination -ceq '/etc/nginx/conf.d/default.conf' })
                $expected = Convert-Q1bMountPath (Join-Path $RepositoryRoot 'benchmarks/nginx.three.conf')
                if ($mount.Count -ne 1 -or $mount[0].RW -ne $false -or (Convert-Q1bMountPath $mount[0].Source) -cne $expected) { throw 'Frontend must use the approved benchmark-specific three-upstream configuration.' }
                $bindings = @($container.ports.'80/tcp')
                if (!$bindings -or @($bindings | Where-Object { $_.HostPort -ne '5173' }).Count) { throw 'Unexpected existing proxy port.' }
            }
        }
    }
    if ($Phase -eq 'BeforeStart') {
        if (@($State.baseline).Count -ne 0) { throw 'Dedicated baseline project is already in use.' }
        if ($State.portFree -ne $true) { throw 'Host loopback port 5174 is unavailable.' }
    } else {
        if (@($State.baseline).Count -ne 1) { throw 'Unexpected or missing baseline project containers; no cleanup or benchmark is permitted.' }
        $proxy = $State.baseline[0]
        if ($proxy.project -cne 'evolve-q1b-baseline' -or $proxy.service -cne 'baseline-proxy' -or $proxy.name -cne '/evolve-q1b-baseline-baseline-proxy-1' -or $proxy.image -cne $ApprovedProxyImage) { throw 'Baseline ownership/image mismatch.' }
        if (@($State.stack | Where-Object { $_.id -ceq $proxy.id }).Count) { throw 'Baseline overlaps original stack.' }
        if ($Phase -eq 'BeforeRun' -and $proxy.running -ne $true) { throw 'Baseline proxy is not running.' }
        if (@($proxy.networks.PSObject.Properties).Count -ne 1 -or !$proxy.networks.evolve_default) { throw 'Unexpected baseline network.' }
        $mounts = @($proxy.mounts)
        $expected = Convert-Q1bMountPath (Join-Path $RepositoryRoot 'benchmarks/nginx.one.conf')
        if ($mounts.Count -ne 1 -or $mounts[0].Destination -cne '/etc/nginx/conf.d/default.conf' -or $mounts[0].RW -ne $false -or (Convert-Q1bMountPath $mounts[0].Source) -cne $expected) { throw 'Unexpected baseline mount.' }
        $ports = @($proxy.ports.'80/tcp')
        if (@($proxy.ports.PSObject.Properties).Count -ne 1 -or $ports.Count -ne 1 -or $ports[0].HostIp -cne '127.0.0.1' -or $ports[0].HostPort -cne '5174') { throw 'Unexpected baseline port mapping.' }
    }
    return [pscustomobject]@{ backendImage = $ApprovedBackendImage; proxyImage = $ApprovedProxyImage; backendImages = @($State.stack | Where-Object { $_.service -ne 'frontend' } | ForEach-Object { $_.image }) }
}
function Invoke-Q1bPreflight {
    param([string]$Phase, [string]$ApprovedBackendImage, [string]$ApprovedProxyImage)
    $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    if ($Phase -eq 'BeforeCleanup') {
        $state = Get-Q1bCleanupState
        $receipt = Assert-Q1bCleanupState -State $state -ApprovedProxyImage $ApprovedProxyImage -RepositoryRoot $root
        if (!$receipt.absent) { Assert-Q1bCleanupConfig -Text (Get-Content -LiteralPath (Join-Path $root 'benchmarks/nginx.one.conf') -Raw -ErrorAction Stop) }
        return $receipt
    }
    & (Join-Path $PSScriptRoot 'validate-q1b.ps1') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Offline configuration validation failed.' }
    $state = Get-Q1bState -CheckPort:($Phase -eq 'BeforeStart')
    return Assert-Q1bState -State $state -Phase $Phase -ApprovedBackendImage $ApprovedBackendImage -ApprovedProxyImage $ApprovedProxyImage -RepositoryRoot $root
}
