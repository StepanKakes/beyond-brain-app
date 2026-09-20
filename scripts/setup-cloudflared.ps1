#Requires -Version 5.1
<#
  Beyond Brain — public address for the events door (Cloudflare Tunnel).

  WAHA, Cal.com and n8n have to reach POST /api/beyond-events/<route> on this
  box, and this box has no public IP. A Cloudflare Tunnel makes
  https://brain.growbeyond.cz (or whatever hostname you pick in the Cloudflare
  dashboard) land on http://localhost:3001 without opening a port.

  Before running:
    1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create tunnel
       (type Cloudflared), name it "beyond-brain".
    2. On the tunnel, add a Public Hostname: brain.growbeyond.cz →
       Service HTTP, URL localhost:3001.
    3. Copy the tunnel token from the "Install and run a connector" step.

  Run (elevated, once):
    powershell -ExecutionPolicy Bypass -File scripts\setup-cloudflared.ps1 -Token <tunnel token>

  What it does: installs cloudflared via winget (or downloads it), registers
  it as a Windows service with the token, starts it. Idempotent: re-running
  with a new token replaces the service.

  After that, set the route secrets in the app .env (BEYOND_EVENT_SECRET_WAHA,
  BEYOND_EVENT_SECRET_CALCOM, BEYOND_EVENT_SECRET_N8N), restart
  BeyondBrainApp, and point the senders at
  https://brain.growbeyond.cz/api/beyond-events/<route>.
#>
param(
  [Parameter(Mandatory = $true)] [string] $Token
)

$ErrorActionPreference = 'Stop'

function Find-Cloudflared {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "$env:ProgramFiles (x86)\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  return $null
}

$exe = Find-Cloudflared
if (-not $exe) {
  Write-Host 'cloudflared not found, installing…'
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements | Out-Null
  } else {
    $dir = Join-Path $env:ProgramFiles 'cloudflared'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile (Join-Path $dir 'cloudflared.exe')
  }
  $exe = Find-Cloudflared
  if (-not $exe) { throw 'cloudflared se nepodařilo nainstalovat' }
}
Write-Host "cloudflared: $exe"

# Replace any previous service so a new token takes effect.
$svc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($svc) {
  Write-Host 'Removing the existing cloudflared service…'
  & $exe service uninstall | Out-Null
  Start-Sleep -Seconds 2
}

Write-Host 'Installing the tunnel as a Windows service…'
& $exe service install $Token
Start-Sleep -Seconds 3
$svc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if (-not $svc) { throw 'služba cloudflared nevznikla' }
if ($svc.Status -ne 'Running') { Start-Service -Name 'cloudflared' }
Set-Service -Name 'cloudflared' -StartupType Automatic

Write-Host ''
Write-Host 'Hotovo. Ověření:'
Write-Host '  Get-Service cloudflared'
Write-Host '  curl https://brain.growbeyond.cz/health'
Write-Host 'Pak do .env appky doplň BEYOND_EVENT_SECRET_* a restartuj BeyondBrainApp.'
