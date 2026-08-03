# Seam D — Installer integration test (Windows)
#
# The Windows counterpart of integration.sh. It is a separate script rather
# than a branch inside that one because the things worth checking differ: the
# installer puts the binary under LOCALAPPDATA instead of ~/.local/bin, and it
# owns PATH through the HKCU\Environment registry key instead of a shell
# fragment. A registry write does not reach this already-running process, so
# the binary is always invoked by absolute path.
#
# Requires MDVL_VERSION — the version just published.
#
# Exit 0 = all pass, 1 = any failure.

if (-not $env:MDVL_VERSION) {
  Write-Error 'MDVL_VERSION is not set — refusing to guess which version to verify.'
  exit 1
}

$pkg = "@flyingmt/mdvl@$($env:MDVL_VERSION)"
$pass = 0
$fail = 0

function Ok($msg) { Write-Host "  [ok] $msg"; $script:pass++ }
function Ko($msg) { Write-Host "  [XX] $msg"; $script:fail++ }

$localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE 'AppData\Local' }
$stateDir = Join-Path $localAppData 'mdvl'
$bin = Join-Path $stateDir 'mdvl.exe'
$receipt = Join-Path $stateDir 'receipt.json'

function Get-UserPath {
  try { (Get-ItemProperty -Path 'HKCU:\Environment' -Name Path -ErrorAction Stop).Path } catch { '' }
}

function Test-PathEntry {
  $entries = (Get-UserPath) -split ';' | Where-Object { $_ }
  return [bool]($entries | Where-Object { $_.TrimEnd('\') -ieq $stateDir.TrimEnd('\') })
}

Write-Host 'Seam D - installer integration'
Write-Host "Package:  $pkg"
Write-Host "Platform: $(node -e "console.log(process.platform + '-' + process.arch)")"
Write-Host ''

# See the note in integration.sh: a version is published before every CDN edge
# serves it, so the command under test is retried rather than gated on a proxy
# check that can reach a different edge.
Write-Host 'Installing...'
$attempt = 1
while ($true) {
  & npx --yes $pkg
  if ($LASTEXITCODE -eq 0) { break }
  if ($attempt -ge 10) {
    Write-Error "npx --yes $pkg still failing after $attempt attempts"
    exit 1
  }
  Write-Host "  attempt $attempt failed - the registry may not serve $($env:MDVL_VERSION) yet; retrying in 10s"
  $attempt++
  Start-Sleep -Seconds 10
}

if (Test-Path -LiteralPath $bin) { Ok "binary installed at $bin" } else { Ko "no binary at $bin" }

$reported = & $bin --version 2>&1
if ($LASTEXITCODE -eq 0 -and "$reported" -match [regex]::Escape($env:MDVL_VERSION)) {
  Ok "mdvl --version reports $($env:MDVL_VERSION)"
} else {
  Ko "mdvl --version did not report $($env:MDVL_VERSION) (got: $reported)"
}

if (Test-Path -LiteralPath $receipt) {
  Ok "receipt written to $receipt"
  $r = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
  if ($r.version -eq $env:MDVL_VERSION -and $r.target -and $r.sha256) {
    Ok 'receipt records version, target and sha256'
  } else {
    Ko 'receipt is missing fields or names the wrong version'
  }
} else {
  Ko "no receipt at $receipt"
}

if (Test-PathEntry) { Ok 'install directory is on the User PATH' } else { Ko 'install directory is not on the User PATH' }

Write-Host ''
Write-Host 'Uninstalling...'
& npx --yes $pkg uninstall
if ($LASTEXITCODE -ne 0) { Write-Error "npx --yes $pkg uninstall failed with exit code $LASTEXITCODE"; exit 1 }

if (Test-Path -LiteralPath $bin) { Ko "binary still at $bin after uninstall" } else { Ok 'binary removed' }
if (Test-Path -LiteralPath $receipt) { Ko "receipt still at $receipt after uninstall" } else { Ok 'receipt removed' }
if (Test-PathEntry) { Ko 'install directory still on the User PATH after uninstall' } else { Ok 'User PATH entry removed' }

Write-Host ''
Write-Host "Results: $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 }
