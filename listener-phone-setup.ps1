# Listener on the phone: deploys the cloud Hub and rebuilds/reinstalls Listener (it can
# now export your library). link-sync.ps1 (run by you) links this PC to the cloud.
$root = Split-Path $PSScriptRoot
$cloud = 'https://hub.arjun-hub.workers.dev'

Write-Output '1/2 Deploying the cloud Hub...'
Push-Location (Join-Path $root 'hub-cloud')
npx.cmd --yes wrangler@4 deploy
Pop-Location

Write-Output '2/2 Rebuilding and reinstalling Listener...'
Push-Location (Join-Path $root 'aurora-music')
& 'C:\Users\pardh\Jarvis\node_modules\.bin\electron-builder.cmd' --win nsis
Pop-Location
$setup = Join-Path $root 'aurora-music\dist\Listener Setup 1.0.0.exe'
Copy-Item $setup (Join-Path $env:USERPROFILE 'Downloads\AIReason Installers\') -Force
Get-Process Listener -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }
Start-Sleep 4
Get-Process Listener -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process -FilePath $setup -ArgumentList '/S' -Wait
Start-Process (Join-Path $env:LOCALAPPDATA 'Programs\aurora-music\Listener.exe')

Write-Output 'Done.'
