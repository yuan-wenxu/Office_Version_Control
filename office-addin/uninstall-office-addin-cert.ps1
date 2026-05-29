$ErrorActionPreference = "Stop"

$caPath = Join-Path $PSScriptRoot "certs\ovc-localhost-ca.crt"
$serverPath = Join-Path $PSScriptRoot "certs\ovc-localhost.crt"
$caCert = if (Test-Path $caPath) {
  New-Object System.Security.Cryptography.X509Certificates.X509Certificate2((Resolve-Path $caPath))
} else {
  $null
}
$serverCert = if (Test-Path $serverPath) {
  New-Object System.Security.Cryptography.X509Certificates.X509Certificate2((Resolve-Path $serverPath))
} else {
  $null
}
$shareName = "OVCOfficeAddinCatalog"
$catalogRegistryPath = "HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\{c8e4cc1a-13dd-49be-90d9-5a8c24f4f7bb}"
$allowedDomainsPath = "HKCU:\Software\Microsoft\Office\16.0\WEF\AllowedAppDomains"
$oldOvcThumbprints = @(
  "2C875078EE38009479F27969EEEE1C1769505C8CEE46FDA2CDF6D9D5D963A9D6",
  "3E780318E2641D79800E2160E8C0D0FCBB22672241AAC1825DC251B7A2C4418A"
)

# Remove OVC CA from all stores where setup-office-addin.ps1 may have placed it.
$locationsToCheck = @(
  @{ Location = "LocalMachine"; Store = "Root" },
  @{ Location = "CurrentUser";  Store = "Root" },
  @{ Location = "CurrentUser";  Store = "TrustedPeople" }
)

foreach ($entry in $locationsToCheck) {
  $store = New-Object System.Security.Cryptography.X509Certificates.X509Store(
    $entry.Store, $entry.Location
  )
  try {
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
  } catch {
    # Skip stores we cannot open (e.g. LocalMachine without admin rights)
    continue
  }

  try {
    $matches = $store.Certificates | Where-Object {
      ($caCert -and $_.Thumbprint -eq $caCert.Thumbprint) -or
      ($serverCert -and $_.Thumbprint -eq $serverCert.Thumbprint) -or
      $oldOvcThumbprints -contains $_.Thumbprint -or
      $_.Subject -eq "CN=OVC Localhost CA" -or
      ($_.Subject -eq "CN=localhost" -and $_.Issuer -eq "CN=OVC Localhost CA")
    }
    foreach ($cert in $matches) {
      $store.Remove($cert)
    }
    if ($matches.Count -gt 0) {
      Write-Host "Removed $($matches.Count) OVC localhost certificate(s) from $($entry.Location)\$($entry.Store)."
    }
  } finally {
    $store.Close()
  }
}

Remove-Item -Recurse -Force $catalogRegistryPath -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $allowedDomainsPath -Name "OVC" -ErrorAction SilentlyContinue

# Remove developer sideloading entry (added for modern M365 without Shared Folder tab)
$developerKeyPath = "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer"
Remove-ItemProperty -Path $developerKeyPath -Name "{c8e4cc1a-13dd-49be-90d9-5a8c24f4f7bb}" `
  -ErrorAction SilentlyContinue

$share = Get-SmbShare -Name $shareName -ErrorAction SilentlyContinue
if ($share) {
  Remove-SmbShare -Name $shareName -Force
  Write-Host "Removed local catalog share: \\$env:COMPUTERNAME\$shareName"
}

# Remove catalog folder and parent OVC folder if empty.
$catalogPath = Join-Path $env:LOCALAPPDATA "OVC\OfficeAddinCatalog"
if (Test-Path $catalogPath) {
  Remove-Item -Recurse -Force $catalogPath
  Write-Host "Removed catalog folder: $catalogPath"
}
$ovcLocalData = Join-Path $env:LOCALAPPDATA "OVC"
if ((Test-Path $ovcLocalData) -and -not (Get-ChildItem $ovcLocalData -ErrorAction SilentlyContinue)) {
  Remove-Item -Force $ovcLocalData
}

# Clear Office WEF cache so Office doesn't show a stale OVC ribbon button
# or a missing-taskpane error after uninstall.
$wefCache = Join-Path $env:LOCALAPPDATA "Microsoft\Office\16.0\Wef"
if (Test-Path $wefCache) {
  Get-ChildItem $wefCache -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
  }
}
