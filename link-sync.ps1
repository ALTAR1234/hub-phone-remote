# Links this PC's phone hub to the cloud Hub: makes a random sync secret, stores it as a
# Cloudflare secret and in %APPDATA%\phone-hub\config.json, then restarts the hub.
$root = Split-Path $PSScriptRoot
$cloud = 'https://hub.arjun-hub.workers.dev'
Push-Location (Join-Path $root 'hub-cloud')
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$tok = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$tok | npx.cmd --yes wrangler@4 secret put SYNC_TOKEN
Pop-Location
$cfgPath = Join-Path $env:APPDATA 'phone-hub\config.json'
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$cfg | Add-Member -NotePropertyName cloudUrl -NotePropertyValue $cloud -Force
$cfg | Add-Member -NotePropertyName cloudToken -NotePropertyValue $tok -Force
[IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Compress))

Write-Output 'Restarting the phone hub; it sends your Listener library in about a minute.'
& (Join-Path $PSScriptRoot 'restart-hub.ps1')
