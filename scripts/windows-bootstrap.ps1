#Requires -Version 5.1
<#
  Beyond Brain — Windows bootstrap

  Co dělá:
    1) Přes winget nainstaluje Node.js LTS, Git, cloudflared
    2) Globálně přes npm nainstaluje @anthropic-ai/claude-code
    3) Naklonuje StepanKakes/beyond-brain a StepanKakes/beyond-brain-app
       do C:\Users\<user>\beyond
    4) Přepne app na branch redesign-v2, npm install + npm run build
    5) Vypíše další manuální kroky (claude login, WAHA MCP, cloudflared tunnel)

  Spuštění z PowerShellu (nemusí být Admin):
    irm https://raw.githubusercontent.com/StepanKakes/beyond-brain-app/redesign-v2/scripts/windows-bootstrap.ps1 | iex
#>

$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Tag, [string]$Msg, [string]$Color = 'Cyan')
  Write-Host "[$Tag] " -ForegroundColor $Color -NoNewline
  Write-Host $Msg
}

function Refresh-Path {
  $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user    = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Install-WingetPkg {
  param([string]$Name, [string]$Id, [string]$CheckCmd)
  if (Get-Command $CheckCmd -ErrorAction SilentlyContinue) {
    Write-Step 'OK' "$Name uz nainstalovany." 'Green'
    return
  }
  Write-Step 'INST' "Instaluju $Name (winget id: $Id)..." 'Yellow'
  winget install --id $Id --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
  Refresh-Path
  if (-not (Get-Command $CheckCmd -ErrorAction SilentlyContinue)) {
    throw "Instalace $Name selhala (po refreshi PATH stale neni $CheckCmd k dispozici). Zavri a otevri PowerShell znova, pak spust script jeste jednou."
  }
}

Write-Host ''
Write-Host '=== Beyond Brain - Windows bootstrap ===' -ForegroundColor Cyan
Write-Host ''

# --- 0. winget check ---
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host 'winget neni dostupny. Updatuj Windows 10/11 nebo nainstaluj "App Installer" z Microsoft Store.' -ForegroundColor Red
  exit 1
}

# --- 1. system packages ---
Install-WingetPkg -Name 'Node.js LTS'  -Id 'OpenJS.NodeJS.LTS'    -CheckCmd 'node'
Install-WingetPkg -Name 'Git'          -Id 'Git.Git'              -CheckCmd 'git'
Install-WingetPkg -Name 'cloudflared'  -Id 'Cloudflare.cloudflared' -CheckCmd 'cloudflared'

Write-Step 'INFO' "node $(node -v),  npm $(npm -v),  git $(git --version),  cloudflared $(cloudflared --version | Select-Object -First 1)"

# --- 2. claude code CLI ---
if (Get-Command claude -ErrorAction SilentlyContinue) {
  Write-Step 'OK' "Claude Code uz nainstalovany ($(claude --version 2>$null))." 'Green'
} else {
  Write-Step 'INST' 'Instaluju @anthropic-ai/claude-code globalne pres npm...' 'Yellow'
  npm install -g '@anthropic-ai/claude-code'
  Refresh-Path
}

# --- 3. workspace ---
$work = Join-Path $env:USERPROFILE 'beyond'
if (-not (Test-Path $work)) {
  New-Item -ItemType Directory -Path $work | Out-Null
  Write-Step 'DIR' "Vytvoren workspace: $work"
}
Set-Location $work

# --- 4. clone repos ---
function Clone-OrPull {
  param([string]$Url, [string]$Dir, [string]$Branch = 'main')
  $target = Join-Path $work $Dir
  if (Test-Path (Join-Path $target '.git')) {
    Write-Step 'GIT' "$Dir uz existuje, delam fetch + checkout $Branch + pull..." 'Yellow'
    Push-Location $target
    git fetch origin
    git checkout $Branch
    git pull --ff-only
    Pop-Location
  } else {
    Write-Step 'GIT' "Klonuju $Url (branch $Branch)..." 'Yellow'
    git clone --branch $Branch $Url $target
  }
}

Clone-OrPull -Url 'https://github.com/StepanKakes/beyond-brain.git'     -Dir 'beyond-brain'     -Branch 'main'
Clone-OrPull -Url 'https://github.com/StepanKakes/beyond-brain-app.git' -Dir 'beyond-brain-app' -Branch 'redesign-v2'

# --- 5. npm install + build ---
Push-Location (Join-Path $work 'beyond-brain-app')
Write-Step 'NPM' 'npm install (chvilku to potrva)...' 'Yellow'
npm install
Write-Step 'NPM' 'npm run build...' 'Yellow'
npm run build
Pop-Location

# --- 6. .env stub ---
$envPath = Join-Path $work 'beyond-brain-app\.env'
if (-not (Test-Path $envPath)) {
  @"
SERVER_PORT=3001
HOST=0.0.0.0
# WHATSAPP_API_KEY=<doplnit z Coolify env vars na waha.growbeyond.cz>
"@ | Set-Content -Path $envPath -Encoding UTF8
  Write-Step 'ENV' "Vytvoren .env stub: $envPath"
}

Write-Host ''
Write-Host '=== Bootstrap hotovo! ===' -ForegroundColor Green
Write-Host ''
Write-Host 'Dalsi kroky (rucne, zavri tuhle PowerShell a otevri novou ať mas cerstvy PATH):' -ForegroundColor Cyan
Write-Host ''
Write-Host "  1) cd $work\beyond-brain-app"
Write-Host '  2) claude        # OAuth login do Max planu (otevre browser)'
Write-Host '  3) Doplnit WHATSAPP_API_KEY do .env (z Coolify env vars waha.growbeyond.cz)'
Write-Host '  4) Vytvorit C:\Users\' -NoNewline
Write-Host $env:USERNAME -NoNewline
Write-Host '\.claude.json se zaznamem o WAHA MCP (posle Claude na Macu)'
Write-Host '  5) npm start    # backend bezi na http://localhost:3001'
Write-Host ''
Write-Host '  6) cloudflared tunnel login                       # OAuth do Cloudflare'
Write-Host '  7) cloudflared tunnel create beyond-brain         # vytvori tunnel'
Write-Host '  8) Pak posli vystup, Claude pripravi config.yml + DNS CNAME + Access policy'
Write-Host ''
