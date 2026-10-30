# Offline validation only. Never resolve service env files or the default .env.
$ErrorActionPreference = 'Stop'
$composeFile = Join-Path $PSScriptRoot '../docker-compose.yml'
$emptyConfigEnv = New-TemporaryFile
try {
    $configJson = & docker compose --env-file $emptyConfigEnv.FullName -f $composeFile config --no-env-resolution --no-interpolate --format json
    if ($LASTEXITCODE -ne 0) { throw 'Compose configuration validation failed.' }
    $model = ($configJson -join "`n") | ConvertFrom-Json
    $apiNames = @('backend1', 'backend2', 'backend3')
    foreach ($apiName in $apiNames) {
        $api = $model.services.$apiName
        if (!$api) { throw "Missing API service: $apiName" }
        if ($api.ports) { throw "API service publishes a host port: $apiName" }
        if (@($api.expose) -notcontains '5000') { throw "API port missing: $apiName" }
        if (($api.command -join ' ') -ne 'node server.js') { throw "Unexpected API command: $apiName" }
        if ($api.environment.PORT -ne '5000' -or $api.environment.PG_POOL_MAX -ne '5' -or $api.environment.TELEMETRY_ENABLED -ne 'false') { throw "Unexpected API environment: $apiName" }
        if (($api.healthcheck.test -join ' ') -notmatch '/health' -or ($api.healthcheck.test -join ' ') -match '/api/db-test') { throw "Unexpected liveness check: $apiName" }
        if ($model.services.frontend.depends_on.$apiName.condition -ne 'service_healthy') { throw "Missing startup liveness dependency: $apiName" }
        if ($api.build.context -ne $model.services.backend1.build.context) { throw 'API build contexts differ.' }
    }
    if ($model.services.frontend.build.args.VITE_API_URL -ne '/') { throw 'Frontend bypasses same-origin proxy mode.' }
    if (!($model.services.frontend.volumes | Where-Object { $_.target -eq '/etc/nginx/conf.d/default.conf' -and $_.read_only -and $_.source -match 'nginx.compose.conf$' })) { throw 'Compose proxy configuration mount missing.' }
    if (@($model.services.frontend.ports).Count -ne 1 -or $model.services.frontend.ports[0].target -ne 80 -or $model.services.frontend.ports[0].published -ne '5173') { throw 'Unexpected frontend published port.' }
    if (@($model.services.telemetry.profiles).Count -ne 1 -or $model.services.telemetry.profiles[0] -ne 'telemetry') { throw 'Telemetry must remain opt-in.' }
    Write-Output 'PASS: Compose model valid; three internal APIs, same-origin proxy, liveness checks and opt-in telemetry verified. Environment files were not resolved.'
} finally {
    Remove-Item -LiteralPath $emptyConfigEnv.FullName
}
