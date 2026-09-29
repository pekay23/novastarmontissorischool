# Runs the GitHub CLI with the gh_token from .env via the GH_TOKEN environment
# variable, which skips the strict scope validation that `gh auth login` does.
# The token is never written to stdout, a file, or a process argument.
# Usage: .\tools\gh.ps1 <gh arguments...>
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GhArgs)

$ErrorActionPreference = 'Stop'
$gh = 'C:\Program Files\GitHub CLI\gh.exe'
$envFile = Join-Path $PSScriptRoot '..\.env'

$line = Select-String -LiteralPath $envFile -Pattern '^\s*gh_token\s*=\s*(.*)$' |
    Select-Object -First 1
if (-not $line) { throw 'gh_token not found in .env' }

$token = $line.Matches[0].Groups[1].Value.Trim().Trim('"', "'")
if ([string]::IsNullOrWhiteSpace($token)) { throw 'gh_token is empty' }

$env:GH_TOKEN = $token
try {
    & $gh @GhArgs
    exit $LASTEXITCODE
}
finally {
    Remove-Item Env:\GH_TOKEN -ErrorAction SilentlyContinue
}
