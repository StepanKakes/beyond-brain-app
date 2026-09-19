#Requires -Version 5.1
<#
  Beyond Brain — one-time GitHub Actions self-hosted runner setup.

  Installs a self-hosted runner on THIS Windows box and registers it with the
  StepanKakes/beyond-brain-app repo, so every push to `main` auto-deploys
  (see .github/workflows/deploy.yml) — the Vercel model, on your own machine.

  MUST BE RUN ELEVATED (Run as Administrator):
    - installing a Windows service requires admin
    - the runner needs to run under an account that can BOTH:
        * read the Git PAT from Credential Manager (to `git fetch` the private repo)
        * restart the BeyondBrainApp service
      => it is installed to run as YOUR user account (you'll be asked for its
         password once). Your account must be a local Administrator for the
         service restart to work.

  Run:
    powershell -ExecutionPolicy Bypass -File scripts\setup-actions-runner.ps1

  Idempotent-ish: re-running reconfigures with --replace.
#>

$ErrorActionPreference = 'Stop'

$Owner   = 'StepanKakes'
$Repo    = 'beyond-brain-app'
$RepoUrl = "https://github.com/$Owner/$Repo"
$AppDir  = Join-Path $env:USERPROFILE 'beyond\beyond-brain-app'
$RunnerDir = 'C:\actions-runner'
$Label   = 'beyond-brain'
$SvcName = 'BeyondBrainApp'

function Step($m) { Write-Host "[setup] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[warn]  $m" -ForegroundColor Yellow }

# --- 0. elevation + admin-membership check -------------------------------------
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  throw "Not elevated. Re-run this in an ADMINISTRATOR PowerShell."
}
Step "Running elevated as $($id.Name)."

# --- 1. get a runner registration token via the Git PAT ------------------------
# We never store or print the PAT; we read it from Credential Manager (same one
# git uses to push) and use it only to mint a short-lived registration token.
Step "Reading GitHub PAT from Credential Manager..."
$credOut = ("protocol=https`nhost=github.com`n`n" | git credential fill) 2>$null
$pat = $null
foreach ($line in $credOut) { if ($line -like 'password=*') { $pat = $line.Substring(9) } }
if (-not $pat) { throw "Could not read a GitHub PAT from Credential Manager. Do a `git push` once first, or store it (see reference_beyond-brain-git)." }

$headers = @{
  Authorization          = "Bearer $pat"
  Accept                 = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent'           = 'beyond-brain-setup'
}
Step "Requesting a runner registration token from GitHub..."
$regToken = (Invoke-RestMethod -Method Post -Headers $headers `
  -Uri "https://api.github.com/repos/$Owner/$Repo/actions/runners/registration-token").token
if (-not $regToken) { throw "Failed to obtain a registration token (is the PAT scope 'repo' and are you an admin of $Owner/$Repo?)." }
$pat = $null  # done with it

# --- 2. download the latest runner --------------------------------------------
if (-not (Test-Path $RunnerDir)) { New-Item -ItemType Directory -Path $RunnerDir | Out-Null }
Set-Location $RunnerDir

if (-not (Test-Path (Join-Path $RunnerDir 'config.cmd'))) {
  Step "Fetching latest actions/runner release info..."
  $rel = Invoke-RestMethod -Headers @{ 'User-Agent' = 'beyond-brain-setup' } `
    -Uri 'https://api.github.com/repos/actions/runner/releases/latest'
  $ver = $rel.tag_name.TrimStart('v')
  $zip = "actions-runner-win-x64-$ver.zip"
  $url = "https://github.com/actions/runner/releases/download/v$ver/$zip"
  Step "Downloading runner v$ver ..."
  Invoke-WebRequest -Uri $url -OutFile (Join-Path $RunnerDir $zip)
  Step "Extracting..."
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $RunnerDir $zip), $RunnerDir)
  Remove-Item (Join-Path $RunnerDir $zip) -Force
} else {
  Step "Runner already extracted in $RunnerDir."
}

# --- 3. account to run the runner service as -----------------------------------
$acct = "$($env:USERDOMAIN)\$($env:USERNAME)"
Step "The runner service will run as: $acct"
Write-Host "        (needed so it can read your Git PAT and restart $SvcName)" -ForegroundColor DarkGray
$secure = Read-Host -AsSecureString "Enter the Windows password for $acct"
$pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

# --- 4. configure + install as service ----------------------------------------
Step "Configuring runner (labels: self-hosted, windows, $Label)..."
& (Join-Path $RunnerDir 'config.cmd') `
    --url $RepoUrl `
    --token $regToken `
    --name "$env:COMPUTERNAME-beyond" `
    --labels $Label `
    --runasservice `
    --windowslogonaccount $acct `
    --windowslogonpassword $pw `
    --unattended `
    --replace
$pw = $null
$secure = $null
if ($LASTEXITCODE -ne 0) { throw "runner config.cmd failed (exit $LASTEXITCODE)." }

# --- 5. persist deploy env for the workflow -----------------------------------
[Environment]::SetEnvironmentVariable('BEYOND_APP_DIR', $AppDir, 'Machine')
[Environment]::SetEnvironmentVariable('BEYOND_SERVICE_NAME', $SvcName, 'Machine')
Step "Set machine env: BEYOND_APP_DIR=$AppDir ; BEYOND_SERVICE_NAME=$SvcName"

Write-Host ''
Write-Host "=== Runner installed and running as a service. ===" -ForegroundColor Green
Write-Host "Verify at: $RepoUrl/settings/actions/runners  (should show a green 'Idle' runner)"
Write-Host "Then trigger the first deploy from: $RepoUrl/actions -> Deploy -> Run workflow"
Write-Host "After that, every push to main deploys automatically."
