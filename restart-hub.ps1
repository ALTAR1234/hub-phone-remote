# Restarts the phone hub hidden (same way it starts at login).
$data = Join-Path $env:APPDATA 'phone-hub'
try { Stop-Process -Id ((Get-Content (Join-Path $data 'hub.json') -Raw | ConvertFrom-Json).pid) -Force } catch {}
Start-Sleep 1
Start-Process wscript.exe -ArgumentList ('"' + (Join-Path ([Environment]::GetFolderPath('Startup')) 'Phone Hub.vbs') + '"')
Start-Sleep 2
Write-Output 'Hub restarted.'
