# Sets the GitHub Actions secrets required by .github/workflows/db-mirror.yml,
# sourcing the values from .env. Values are piped on stdin rather than passed
# as arguments, so they never appear in a process listing or in this script.
# Usage: .\tools\gh-set-secrets.ps1
$ErrorActionPreference = 'Stop'
$gh = 'C:\Program Files\GitHub CLI\gh.exe'
$envFile = Join-Path $PSScriptRoot '..\.env'

# GitHub Actions secret name -> key in .env
$required = @{
    'DATABASE_URL'          = 'DATABASE_URL'
    'SUPABASE_DATABASE_URL' = 'SUPABASE_DATABASE_URL'
    'DATABASE_URL_RLS'      = 'DATABASE_URL_RLS'
}

$values = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        $key = $Matches[1]
        $val = $Matches[2].Trim().Trim('"', "'")
        if (-not $values.ContainsKey($key)) { $values[$key] = $val }
    }
}

$token = $values['gh_token']
if ([string]::IsNullOrWhiteSpace($token)) { throw 'gh_token is missing or empty in .env' }
$env:GH_TOKEN = $token

try {
    foreach ($secret in $required.Keys | Sort-Object) {
        $source = $required[$secret]
        if (-not $values.ContainsKey($source) -or [string]::IsNullOrWhiteSpace($values[$source])) {
            throw "$source is missing or empty in .env; cannot set secret $secret"
        }
        # Report only the host, never the credentials.
        $dbHost = ([regex]::Match($values[$source], '@([^/:\s]+)')).Groups[1].Value
        $values[$source] | & $gh secret set $secret --repo pekay23/novastarmontissorischool
        if ($LASTEXITCODE -ne 0) { throw "gh secret set $secret failed" }
        Write-Output "set $secret -> $dbHost"
    }

    Write-Output "`nSecrets now on the repository:"
    & $gh secret list --repo pekay23/novastarmontissorischool
}
finally {
    Remove-Item Env:\GH_TOKEN -ErrorAction SilentlyContinue
    $values = $null
}
