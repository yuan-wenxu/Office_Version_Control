$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$shareName = "OVCOfficeAddinCatalog"
$catalogPath = Join-Path $env:LOCALAPPDATA "OVC\OfficeAddinCatalog"
$catalogUnc = "\\$env:COMPUTERNAME\$shareName"
$catalogRegistryPath = "HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\{c8e4cc1a-13dd-49be-90d9-5a8c24f4f7bb}"
$allowedDomainsPath = "HKCU:\Software\Microsoft\Office\16.0\WEF\AllowedAppDomains"
$manifestSource = Join-Path $PSScriptRoot "manifest.xml"
$manifestTarget = Join-Path $catalogPath "manifest.xml"

if (-not $isAdmin) {
  Write-Host "Requesting Administrator permission for Office catalog setup..."
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "`"$PSCommandPath`""
  )
  Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments
  exit
}

& (Join-Path $PSScriptRoot "install-office-addin-cert.ps1")

Write-Host ""
Write-Host "Clearing Office WEF cache (ensures updated manifest is loaded fresh)..."
$wefCache = Join-Path $env:LOCALAPPDATA "Microsoft\Office\16.0\Wef"
if (Test-Path $wefCache) {
  Get-ChildItem $wefCache -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
  }
  Write-Host "WEF cache cleared: $wefCache"
}

Write-Host ""
Write-Host "Configuring Office WebView localhost loopback exemption..."

if ($isAdmin) {
  CheckNetIsolation LoopbackExempt -a -n="microsoft.win32webviewhost_cw5n1h2txyewy" | Out-Host
  Write-Host "Loopback exemption command finished."
}

Write-Host ""
Write-Host "Configuring Office trusted add-in catalog..."

New-Item -ItemType Directory -Force -Path $catalogPath | Out-Null
Copy-Item -Force $manifestSource $manifestTarget

$existingShare = Get-SmbShare -Name $shareName -ErrorAction SilentlyContinue
if ($existingShare) {
  Remove-SmbShare -Name $shareName -Force
}

try {
  New-SmbShare -Name $shareName -Path $catalogPath -Description "OVC Office Add-in Catalog" | Out-Null
  $account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  Grant-SmbShareAccess -Name $shareName -AccountName $account -AccessRight Full -Force | Out-Null
} catch {
  net.exe share "$shareName=$catalogPath" "/GRANT:$env:USERNAME,FULL" | Out-Null
}
Write-Host "Created local catalog share: $catalogUnc"

New-Item -Force -Path $catalogRegistryPath | Out-Null
New-ItemProperty -Force -Path $catalogRegistryPath -Name "Id" -Value "{c8e4cc1a-13dd-49be-90d9-5a8c24f4f7bb}" -PropertyType String | Out-Null
New-ItemProperty -Force -Path $catalogRegistryPath -Name "Url" -Value $catalogUnc -PropertyType String | Out-Null
New-ItemProperty -Force -Path $catalogRegistryPath -Name "Flags" -Value 1 -PropertyType DWord | Out-Null

New-Item -Force -Path $allowedDomainsPath | Out-Null
New-ItemProperty -Force -Path $allowedDomainsPath -Name "OVC" -Value "https://localhost:38655" -PropertyType String | Out-Null
Write-Host "Registered trusted catalog in Office: $catalogUnc"

# ── Modern sideloading for Microsoft 365 builds that removed "Shared Folder" ──
# Some recent M365 builds no longer show the "Shared Folder" tab in the
# Office Add-ins dialog.  Writing a value under WEF\Developer registers the
# add-in directly so it appears in Insert > Add-ins > My Add-ins without
# requiring any Shared Folder entry.
$developerKeyPath = "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer"
$addinGuid = "{c8e4cc1a-13dd-49be-90d9-5a8c24f4f7bb}"
New-Item -Force -Path $developerKeyPath | Out-Null
New-ItemProperty -Force -Path $developerKeyPath `
  -Name $addinGuid -Value $manifestTarget -PropertyType String | Out-Null
Write-Host "Registered add-in for direct sideloading (WEF\Developer): $manifestTarget"

Write-Host ""
Write-Host "Setup finished."
Write-Host "  1. Close and reopen Word / Excel / PowerPoint."
Write-Host "  2. An 'OVC' button will appear in the Home tab ribbon."
Write-Host "  3. Click it to open the OVC panel on the right side."
Write-Host "  4. Click the pin icon (top-right of the panel) to keep it docked."
Write-Host "     The panel will stay visible while you work and close only when"
Write-Host "     you click the X button."
Write-Host ""
Write-Host "  Note: OVC desktop app must be running before using the add-in."
