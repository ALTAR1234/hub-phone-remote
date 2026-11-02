# Closes any running copies of Listener, Gamer, Weber and Streamer, then installs the
# latest builds from Downloads\AIReason Installers (silently, for this user).
# Run it from a normal PowerShell window so the installs register with Windows properly.
$installers = Join-Path $env:USERPROFILE 'Downloads\AIReason Installers'
$apps = 'weber-browser', 'aurora-music', 'nexus-games', 'Programs\Streamer', 'AIReason\weber', 'AIReason\aurora-music', 'AIReason\nexus', 'AIReason\streamer-tv'
Write-Output 'Closing the apps...'
Get-CimInstance Win32_Process | Where-Object { $p = $_.ExecutablePath; $p -and ($apps | Where-Object { $p -like "*\$_\*" }) } | ForEach-Object {
  $proc = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  if ($proc -and $proc.MainWindowHandle -ne 0) { [void]$proc.CloseMainWindow() }
}
Start-Sleep 5
Get-CimInstance Win32_Process | Where-Object { $p = $_.ExecutablePath; $p -and ($apps | Where-Object { $p -like "*\$_\*" }) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep 2
foreach ($name in 'Weber', 'Listener', 'Gamer') {
  $setup = Join-Path $installers "$name Setup 1.0.0.exe"
  Write-Output "Installing $name..."
  $p = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru -Wait
  Write-Output "  done (exit $($p.ExitCode))"
}
Write-Output 'Installing Streamer...'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $env:USERPROFILE 'OneDrive\Desktop\AIReason\streamer-tv\install-streamer.ps1')
Write-Output 'All four apps are up to date.'
