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
  Write-Host "Requesting Administrator permission for Office add-in setup..."
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

Write-Host "OVC Office add-in setup"
Write-Host ""
Write-Host "Preparing OVC localhost certificates..."

$certDir = Join-Path $PSScriptRoot "certs"
$caPath = Join-Path $PSScriptRoot "certs\ovc-localhost-ca.crt"
$caKeyPath = Join-Path $PSScriptRoot "certs\ovc-localhost-ca.key"
$serverPath = Join-Path $PSScriptRoot "certs\ovc-localhost.crt"
$serverKeyPath = Join-Path $PSScriptRoot "certs\ovc-localhost.key"
$generatedCertFiles = @($caPath, $caKeyPath, $serverPath, $serverKeyPath)
$oldOvcThumbprints = @(
  "2C875078EE38009479F27969EEEE1C1769505C8CEE46FDA2CDF6D9D5D963A9D6",
  "3E780318E2641D79800E2160E8C0D0FCBB22672241AAC1825DC251B7A2C4418A",
  "6C1FA4E69E1ECE87C0C567502FB7BB636CC044ED",
  "E1E2BCAEBD638B1E1C2844DE38333D1EC3504307"
)

function Find-OvcExe {
  $candidates = @(
    (Join-Path $PSScriptRoot "..\..\ovc.exe"),
    (Join-Path $PSScriptRoot "..\ovc.exe"),
    (Join-Path $PSScriptRoot "..\src-tauri\target\debug\ovc.exe"),
    (Join-Path $PSScriptRoot "..\src-tauri\target\release\ovc.exe"),
    (Join-Path (Get-Location) "ovc.exe")
  )
  foreach ($candidate in $candidates) {
    $resolved = Resolve-Path $candidate -ErrorAction SilentlyContinue
    if ($resolved) { return $resolved.Path }
  }
  return $null
}

function Generate-OvcCertificates {
  New-Item -ItemType Directory -Force -Path $certDir | Out-Null
  $ovcExe = Find-OvcExe
  if (-not $ovcExe) {
    throw "OVC executable was not found. Cannot generate localhost certificates."
  }

  Write-Host "Generating machine-local certificates with: $ovcExe"
  & $ovcExe --generate-office-certs $PSScriptRoot
  if ($LASTEXITCODE -ne 0) {
    throw "OVC certificate generation failed with exit code $LASTEXITCODE."
  }
}

$needsGeneration = $false
foreach ($file in $generatedCertFiles) {
  if (-not (Test-Path $file)) { $needsGeneration = $true }
}
if (-not $needsGeneration) {
  try {
    $existingCa = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2((Resolve-Path $caPath))
    if ($oldOvcThumbprints -contains $existingCa.Thumbprint) {
      Write-Host "Found legacy packaged OVC certificate; regenerating a machine-local certificate."
      $needsGeneration = $true
    }
  } catch {
    $needsGeneration = $true
  }
}
if ($needsGeneration) {
  foreach ($file in $generatedCertFiles) {
    Remove-Item -Force $file -ErrorAction SilentlyContinue
  }
  Generate-OvcCertificates
}

Write-Host "Installing OVC localhost certificates..."
$caCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2((Resolve-Path $caPath))
$serverCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2((Resolve-Path $serverPath))

function Invoke-WithStore($storeName, $storeLocation, [scriptblock]$action) {
  $store = New-Object System.Security.Cryptography.X509Certificates.X509Store(
    $storeName, $storeLocation
  )
  $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
  try { & $action $store }
  finally { $store.Close() }
}

$locationsToClean = @(
  @{ Store = "Root";          Location = "LocalMachine" },
  @{ Store = "Root";          Location = "CurrentUser"  },
  @{ Store = "TrustedPeople"; Location = "CurrentUser"  }
)
foreach ($entry in $locationsToClean) {
  try {
    Invoke-WithStore $entry.Store $entry.Location {
      param($store)
      $stale = $store.Certificates | Where-Object {
        $oldOvcThumbprints -contains $_.Thumbprint -or
        ($_.Subject -eq "CN=OVC Localhost CA" -and $_.Thumbprint -ne $caCert.Thumbprint) -or
        ($_.Subject -eq "CN=localhost" -and $_.Issuer -eq "CN=OVC Localhost CA" -and $_.Thumbprint -ne $serverCert.Thumbprint)
      }
      foreach ($cert in $stale) { $store.Remove($cert) }
    }
  } catch { <# skip stores we cannot open #> }
}

Invoke-WithStore "Root" "LocalMachine" {
  param($store)
  $existing = $store.Certificates | Where-Object { $_.Thumbprint -eq $caCert.Thumbprint }
  if (-not $existing) {
    $store.Add($caCert)
  }
}
Write-Host "  CA trusted in LocalMachine\Root"

Invoke-WithStore "TrustedPeople" "CurrentUser" {
  param($store)
  $existing = $store.Certificates | Where-Object { $_.Thumbprint -eq $serverCert.Thumbprint }
  if (-not $existing) {
    $store.Add($serverCert)
  }
}
Write-Host "  Server certificate trusted in CurrentUser\TrustedPeople"

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
