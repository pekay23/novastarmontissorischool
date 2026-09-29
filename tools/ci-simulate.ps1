# Simulates the CI environment to prove .github/workflows/db-mirror.yml works.
#
# The workflow runs on a fresh runner: no .env, no .env.local, and the three
# secrets present as real environment variables. The local env.ts uses dotenv
# `override: true` so .env.local beats .env under Bun's auto-load, which would
# be dangerous if CI had a .env file. CI does not, because .env is gitignored.
# This script hides both files and runs the exact commands the workflow runs,
# so that assumption is verified rather than hoped.
$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
$envLocal = Join-Path $root '.env.local'
$hiddenEnv = Join-Path $root '.env.ci-hidden'
$hiddenLocal = Join-Path $root '.env.local.ci-hidden'
$log = Join-Path $env:TEMP 'ci-sim-step.log'

$values = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        $key = $Matches[1]
        if (-not $values.ContainsKey($key)) { $values[$key] = $Matches[2].Trim().Trim('"', "'") }
    }
}

# Sets $script:stepOk rather than returning a value: a PowerShell function
# returns everything it writes to the output stream, so returning a status
# alongside the log lines would make the caller test a truthy array and
# report success unconditionally.
function Invoke-Step($name, $script, $argLine) {
    $script:stepOk = $false
    Write-Output "=== $name ==="
    if ($argLine) {
        & bun run (Join-Path $root $script) $argLine *> $log
    }
    else {
        & bun run (Join-Path $root $script) *> $log
    }
    $code = $LASTEXITCODE
    Get-Content -LiteralPath $log |
        Where-Object { $_ -notmatch 'sslmode|libpq|pg-connection-string|libpq-ssl|trace-warnings|Alias|CategoryInfo|FullyQualifiedErrorId|^\s*\+|^\s*at |bun\.exe|^\s*$' } |
        Select-Object -Last 7
    if ($code -eq 0) { $script:stepOk = $true; Write-Output '  -> ok' }
    else { Write-Output "  -> FAILED (exit $code)" }
    Write-Output ''
}

$ok = $true
try {
    Move-Item -LiteralPath $envFile -Destination $hiddenEnv -Force
    Move-Item -LiteralPath $envLocal -Destination $hiddenLocal -Force
    Write-Output '.env and .env.local hidden. Secrets in scope: DATABASE_URL, SUPABASE_DATABASE_URL, DATABASE_URL_RLS'
    Write-Output ''

    # Actions injects secrets as real environment variables. Do the same.
    $env:DATABASE_URL = $values['DATABASE_URL']
    $env:SUPABASE_DATABASE_URL = $values['SUPABASE_DATABASE_URL']
    $env:DATABASE_URL_RLS = $values['DATABASE_URL_RLS']

    foreach ($v in 'DATABASE_URL', 'SUPABASE_DATABASE_URL', 'DATABASE_URL_RLS') {
        Write-Output ("  {0,-24} injected={1}" -f $v, (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($v))))
    }
    Write-Output ''

    Invoke-Step 'Mirror (verify-only)' 'tools/db-mirror/mirror.ts' '--verify-only'; if (-not $script:stepOk) { $ok = $false }
    Invoke-Step 'Verify restore readiness' 'tools/db-mirror/verify-restore.ts' ''; if (-not $script:stepOk) { $ok = $false }
    Invoke-Step 'Verify RLS on primary' 'tools/db-mirror/verify-rls-enforced.ts' 'neon'; if (-not $script:stepOk) { $ok = $false }
}
finally {
    if (Test-Path $hiddenEnv) { Move-Item -LiteralPath $hiddenEnv -Destination $envFile -Force }
    if (Test-Path $hiddenLocal) { Move-Item -LiteralPath $hiddenLocal -Destination $envLocal -Force }
    Remove-Item Env:\DATABASE_URL, Env:\SUPABASE_DATABASE_URL, Env:\DATABASE_URL_RLS -ErrorAction SilentlyContinue
    Remove-Item $log -ErrorAction SilentlyContinue
    $values = $null
    Write-Output ''
    Write-Output '.env and .env.local restored.'
}

if (-not $ok) { Write-Output 'CI SIMULATION: FAILED'; exit 1 }
Write-Output 'CI SIMULATION: PASSED'
