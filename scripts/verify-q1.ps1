param([string]$EvidenceDirectory=(Join-Path $PSScriptRoot '../docs/da3/q1/evidence/verification'))
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')); $directory=[IO.Path]::GetFullPath($EvidenceDirectory)
if(Test-Path (Join-Path $directory 'results.json')){throw 'Verification evidence exists; select a new evidence directory.'}
New-Item -ItemType Directory -Path $directory -Force|Out-Null
$results=[Collections.Generic.List[object]]::new()
function Check-Q1 {
 param([string]$Name,[string]$Command,[scriptblock]$Action)
 $global:LASTEXITCODE=0; $start=[DateTimeOffset]::UtcNow.ToString('o'); $output=@(); $code=0
 try{$output=@(& $Action 2>&1);$code=$LASTEXITCODE}catch{$output+= $_.Exception.Message;$code=1}
 $output|ForEach-Object { [regex]::Replace("$_",'\x1B\[[0-?]*[ -/]*[@-~]','') }|Set-Content (Join-Path $directory "$Name.txt") -Encoding utf8
 $results.Add([pscustomobject]@{name=$Name;command=$Command;exitCode=$code;passed=($code -eq 0);startedUtc=$start;finishedUtc=[DateTimeOffset]::UtcNow.ToString('o');log="$Name.txt"})
 Write-Output "$Name : exit $code"
}
Push-Location $root
try{
 Check-Q1 backend-tests 'cd backend; npm test' {Push-Location backend;try{npm test}finally{Pop-Location}}
 Check-Q1 frontend-routing-tests 'node --test backend/test/frontend-config.test.js' {node --test backend/test/frontend-config.test.js}
 Check-Q1 benchmark-tests 'node --test benchmarks/prepare.test.cjs benchmarks/failure.test.cjs' {node --test benchmarks/prepare.test.cjs benchmarks/failure.test.cjs}
 Check-Q1 recovery-tests './benchmarks/preflight.tests.ps1' {& ./benchmarks/preflight.tests.ps1}
 Check-Q1 frontend-build 'VITE_API_URL=/ npm run build (frontend)' {$env:VITE_API_URL='/';Push-Location frontend;try{npm run build}finally{Pop-Location}}
 Check-Q1 frontend-lint 'frontend eslint; sanitized diagnostics only' {Push-Location frontend;try{$json=& node node_modules/eslint/bin/eslint.js . --format json;$lintCode=$LASTEXITCODE; $data=($json -join "`n")|ConvertFrom-Json;foreach($file in $data){foreach($message in $file.messages){[pscustomobject]@{file=$file.filePath;line=$message.line;severity=$message.severity;rule=$message.ruleId;message=($message.message -split "`n")[0]}|ConvertTo-Json -Compress}};$global:LASTEXITCODE=$lintCode}finally{Pop-Location}}
 Check-Q1 javascript-syntax 'node --check backend and benchmark JS/MJS/CJS; frontend config' {$files=@(Get-ChildItem backend -Recurse -File|Where-Object{$_.Extension -eq '.js' -and $_.FullName -notmatch '[\\/]node_modules[\\/]'})+@(Get-ChildItem benchmarks -File|Where-Object{$_.Extension -in @('.js','.mjs','.cjs')})+@(Get-Item frontend/src/config.js);foreach($file in $files){node --check $file.FullName;if($LASTEXITCODE -ne 0){throw 'JavaScript syntax failure.'}};Write-Output 'All selected JavaScript syntax checks passed.'}
 Check-Q1 powershell-syntax 'Parser.ParseFile on all scripts and preflight tests' {foreach($file in (@(Get-ChildItem scripts -Filter '*.ps1')+@(Get-Item benchmarks/preflight.tests.ps1))){$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|Select-Object Message;throw 'PowerShell syntax failure.'}};Write-Output 'All PowerShell syntax checks passed.'}
 Check-Q1 compose-q1a './scripts/validate-compose.ps1' {& ./scripts/validate-compose.ps1}
 Check-Q1 compose-q1b './scripts/validate-q1b.ps1' {& ./scripts/validate-q1b.ps1}
 Check-Q1 compose-q1c 'docker compose config with no service env resolution; before and after overlays' {$env:Q1B_BACKEND_IMAGE='sha256:0fd2b2d4ca403d6756563e75a1bb995f7972420bb6694e6d59062fa8b0356d96';$env:Q1B_PROXY_IMAGE='sha256:046f9aac7098d53939f4ce1f50a0c59e69100c7c0bf88938107112aa29bef8d0';foreach($phase in @('before','after')){$env:Q1C_PHASE=$phase;$json=& docker compose --env-file NUL -p evolve -f docker-compose.yml -f benchmarks/compose.three.override.yml -f benchmarks/compose.failover.override.yml config --no-env-resolution --format json;if($LASTEXITCODE -ne 0){throw 'Failure overlay invalid.'};$model=($json -join "`n")|ConvertFrom-Json;if(!($model.services.frontend.volumes|Where-Object{$_.source -match "nginx.failover-$phase.conf$" -and $_.read_only})){throw 'Incorrect failure mount.'};Write-Output "$phase overlay valid; no environment files resolved."}}
 Check-Q1 whitespace 'git -c core.fsmonitor=false diff --check' {git -c core.fsmonitor=false diff --check}
}finally{Pop-Location;$results|ConvertTo-Json -Depth 10|Set-Content (Join-Path $directory 'results.json') -Encoding utf8}
