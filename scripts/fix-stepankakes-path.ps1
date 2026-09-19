#requires -RunAsAdministrator
# One-shot cleanup after patching claude-sdk.js/gemini-cli.js handleImages cwd resolution.
#
# Restarts the BeyondBrainApp service so it picks up the rebuilt dist-server, migrates any
# previously-stranded image uploads from the phantom C:\Users\stepankakes\... tree into the
# real brain repo, and removes the empty phantom directory.

$ErrorActionPreference = 'Stop'

$Service       = 'BeyondBrainApp'
$BrainRepo     = 'C:\Users\Vlast\beyond\beyond-brain'
$PhantomRoot   = 'C:\Users\stepankakes'
$PhantomBrain  = "$PhantomRoot\Documents\GitHub\beyond-brain"
$SourceImages  = "$PhantomBrain\.tmp\images"
$TargetImages  = "$BrainRepo\.tmp\images"

Write-Host "==> Step 1/5  Stop $Service"
Stop-Service $Service -Force
(Get-Service $Service).WaitForStatus('Stopped', '00:00:30')

Write-Host "==> Step 2/5  Ensure target $TargetImages"
New-Item -ItemType Directory -Path $TargetImages -Force | Out-Null

Write-Host "==> Step 3/5  Migrate stranded images (if any)"
if (Test-Path $SourceImages) {
    $items = Get-ChildItem $SourceImages -Force -ErrorAction SilentlyContinue
    if ($items) {
        Write-Host "    Moving $($items.Count) entries..."
        Move-Item -Path "$SourceImages\*" -Destination $TargetImages -Force
    } else {
        Write-Host "    (source empty, nothing to move)"
    }
} else {
    Write-Host "    (no source folder, nothing to move)"
}

Write-Host "==> Step 4/5  Delete phantom $PhantomBrain"
if (Test-Path $PhantomBrain) {
    Remove-Item $PhantomBrain -Recurse -Force
}
# Clean up empty parents up to (but not including) C:\Users
$cleanup = @("$PhantomRoot\Documents\GitHub", "$PhantomRoot\Documents", $PhantomRoot)
foreach ($p in $cleanup) {
    if ((Test-Path $p) -and -not (Get-ChildItem $p -Force -ErrorAction SilentlyContinue)) {
        Remove-Item $p -Force
        Write-Host "    removed empty $p"
    }
}

Write-Host "==> Step 5/5  Start $Service and verify"
Start-Service $Service
(Get-Service $Service).WaitForStatus('Running', '00:00:30')
Start-Sleep -Seconds 3
$conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    $p = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    Write-Host ("    OK  port 3001 owned by PID {0} ({1}), started {2}" -f $conn.OwningProcess, $p.Name, $p.StartTime)
} else {
    Write-Warning "Port 3001 not listening yet - check C:\Users\Vlast\beyond\beyond-brain-app\service-stderr.log"
}

Write-Host ""
Write-Host "Done. Phantom path removed:  $((-not (Test-Path $PhantomBrain)))"
Write-Host "Real upload dir present:     $((Test-Path $TargetImages))"
