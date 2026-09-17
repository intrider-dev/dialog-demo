param([switch]$SkipDocker, [switch]$Check)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 24.14 or newer, then run this script again.'
}
$setupArgs = @()
if ($SkipDocker) { $setupArgs += '--skip-docker' }
if ($Check) { $setupArgs += '--check' }
& node (Join-Path $PSScriptRoot 'scripts/setup.mjs') @setupArgs
if ($LASTEXITCODE -ne 0) { throw 'Installation failed. See the error above.' }
