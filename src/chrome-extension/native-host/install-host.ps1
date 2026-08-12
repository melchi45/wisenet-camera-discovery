# Registers the Wisenet UDP native messaging host for Google Chrome
# (current user, HKCU). Usage:
#   powershell -ExecutionPolicy Bypass -File install-host.ps1 <extension-id>
param(
    [Parameter(Mandatory = $true)]
    [string]$ExtensionId
)

$hostName = 'com.wisenet.ipinstaller'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Warning 'node was not found in PATH; the host needs Node.js to run.'
}

$manifest = [ordered]@{
    name            = $hostName
    description     = 'Wisenet IP Installer UDP discovery native host'
    path            = (Join-Path $dir 'wisenet-udp-host.bat')
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}

# The manifest itself is written outside this script's own directory —
# when run from dist/chrome-extension/native-host/ (the built output,
# not this checked-in source copy), that directory gets wiped and
# recreated by every `npm run build`, which would delete this file and
# silently break the registry entry below (its (default) value would
# point at a manifest that no longer exists). $manifest.path above still
# points *into* dist/ — that's fine, since build.js recreates
# wisenet-udp-host.bat at that same path every time; only the manifest
# registration itself needs to live somewhere stable. Mirrors
# install-host.sh's use of a stable OS-standard directory
# (~/.config/google-chrome/NativeMessagingHosts) instead of writing next
# to itself, for the same reason.
$stableDir = Join-Path $env:LOCALAPPDATA 'WisenetIPInstaller\native-host'
New-Item -Path $stableDir -ItemType Directory -Force | Out-Null
$manifestPath = Join-Path $stableDir "$hostName.json"
$manifest | ConvertTo-Json | Set-Content -Encoding UTF8 $manifestPath

$regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
New-Item -Path $regPath -Force | Out-Null
Set-ItemProperty -Path $regPath -Name '(default)' -Value $manifestPath

Write-Host "Installed: $manifestPath"
Write-Host "Registry:  $regPath"
Write-Host "Restart Chrome, then click 'Start Discovery' in the extension window."
