# Sets up the phone remote: starts the hub at login (hidden), installs Tailscale,
# serves the hub to your own Tailscale devices over HTTPS, then shows the pairing QR.
$ErrorActionPreference = 'Stop'
$hubDir = $PSScriptRoot
$node = 'C:\Program Files\nodejs\node.exe'
$data = Join-Path $env:APPDATA 'phone-hub'

# 1. start at login: a hidden launcher in your Startup folder (delete it to undo)
$startup = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $startup 'Phone Hub.vbs'
@"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$hubDir"
sh.Run """$node"" server.mjs", 0, False
"@ | Set-Content -Encoding ASCII $vbs
Write-Output "Autostart added: $vbs"

# 2. Tailscale
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
if (-not (Test-Path $ts)) {
  Write-Output ''
  Write-Output 'Installing Tailscale from winget. Accept its agreement and the Windows prompt if asked.'
  winget install --id Tailscale.Tailscale -e
  if (-not (Test-Path $ts)) { throw 'Tailscale did not install. Run this script again.' }
}
Write-Output ''
Write-Output 'Sign in to Tailscale in the browser window that opens (Google, Microsoft or Apple works).'
& $ts up
while ($true) {
  $st = & $ts status --json | ConvertFrom-Json
  if ($st.BackendState -eq 'Running') { break }
  Start-Sleep 2
}

# 3. serve the hub over HTTPS to your own devices only (not the public internet)
Write-Output ''
Write-Output 'Turning on HTTPS for the hub. If Tailscale prints a link to enable HTTPS, open it and click Enable, then come back.'
& $ts serve --bg 47800
$name = ((& $ts status --json | ConvertFrom-Json).Self.DNSName).TrimEnd('.')
$url = "https://$name"

# 4. save the address and restart the hub hidden
$cfgPath = Join-Path $data 'config.json'
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$cfg | Add-Member -NotePropertyName publicUrl -NotePropertyValue $url -Force
[IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Compress))  # no BOM: node's JSON.parse rejects one
try { Stop-Process -Id ((Get-Content (Join-Path $data 'hub.json') -Raw | ConvertFrom-Json).pid) -Force } catch {}
Start-Sleep 1
Start-Process wscript.exe -ArgumentList "`"$vbs`""
Start-Sleep 2
Write-Output ''
Write-Output "Done. Remote address: $url"
Write-Output 'Next: install Tailscale on your iPhone, sign in with the same account, then scan the QR code that opens now.'
Start-Process 'http://127.0.0.1:47800/pair'
