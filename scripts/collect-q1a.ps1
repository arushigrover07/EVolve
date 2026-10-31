param([string]$EvidenceDirectory = (Join-Path $PSScriptRoot '../docs/da3/q1/evidence'), [int]$Requests = 30, [ValidateSet('Instance','Stations')][string]$Endpoint = 'Instance')
$ErrorActionPreference = 'Stop'
if ($Requests -lt 3 -or $Requests -gt 100) { throw 'Use 3 to 100 lightweight identity requests.' }
$directory = [IO.Path]::GetFullPath($EvidenceDirectory)
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$stem = if ($Endpoint -eq 'Stations') { 'q1a-stations' } else { 'q1a-distribution' }
$path = if ($Endpoint -eq 'Stations') { '/api/stations' } else { '/api/instance' }
$file = Join-Path $directory ($stem + '.csv')
if (Test-Path $file) { throw 'Distribution evidence exists; do not overwrite.' }
$rows = @()
for ($number=1; $number -le $Requests; $number++) {
    $status=0; $id=''; $success=$false; $dataHash=$null
    try {
        $response=try { Invoke-WebRequest -Uri ('http://127.0.0.1:5173'+$path) -TimeoutSec 10 -DisableKeepAlive -UseBasicParsing } catch { if ($_.Exception.Response) { $_.Exception.Response } else { throw } }
        $status=[int]$response.StatusCode; $payload=$response.Content | ConvertFrom-Json
        if ($Endpoint -eq 'Stations') {
            $id=[string]$response.Headers['X-Instance-Id']
            $success=$status -eq 200 -and $payload -is [array] -and $id -match '^[a-f0-9-]{36}$'
            $dataHash=[BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($response.Content))).Replace("-","").ToLowerInvariant()
        } else {
            if ($payload.instanceId -match '^[a-f0-9-]{36}$') { $id=$payload.instanceId }
            $success=$status -eq 200 -and $id -ne '' -and [string]$response.Headers['X-Instance-Id'] -ceq $id
        }
    } catch { $success=$false }
    $rows += [pscustomobject]@{ requestNumber=$number; timestampUtc=[DateTimeOffset]::UtcNow.ToString('o'); httpStatus=$status; backendInstanceId=$id; succeeded=$success; dataSha256=$dataHash }
}
$rows | Export-Csv -LiteralPath $file -NoTypeInformation
$counts=@($rows | Where-Object succeeded | Group-Object backendInstanceId | Select-Object @{n='backendInstanceId';e={$_.Name}},Count)
[pscustomobject]@{ requests=$Requests; successes=@($rows|Where-Object succeeded).Count; distinctBackendInstances=$counts.Count; counts=$counts; endpoint=$path; observedDataHashes=@($rows.dataSha256|Where-Object { $_ }|Sort-Object -Unique); note=if($Endpoint -eq 'Stations'){'Database-backed read evidence; hashes only, no response bodies saved.'}else{'Identity endpoint only; no database query.'} } | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $directory ($stem + '-summary.json')) -Encoding utf8
if (@($rows | Where-Object { !$_.succeeded }).Count -gt 0 -or $counts.Count -ne 3) { throw 'Distribution evidence incomplete; inspect actual rows.' }
Write-Output "$Requests requests succeeded across $($counts.Count) distinct backend instance IDs."

if ($Endpoint -eq 'Stations' -and @($rows.dataSha256|Sort-Object -Unique).Count -ne 1) { throw 'Observed station data changed; equivalence not demonstrated.' }
