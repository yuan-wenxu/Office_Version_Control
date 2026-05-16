$ErrorActionPreference = "Stop"

$caPath = Join-Path $PSScriptRoot "certs\ovc-localhost-ca.crt"
$serverPath = Join-Path $PSScriptRoot "certs\ovc-localhost.crt"

if (-not (Test-Path $caPath)) {
  throw "CA certificate not found: $caPath"
}
if (-not (Test-Path $serverPath)) {
  throw "Server certificate not found: $serverPath"
}

$resolvedCaPath = Resolve-Path $caPath
$resolvedServerPath = Resolve-Path $serverPath
$caCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($resolvedCaPath)
$serverCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($resolvedServerPath)
$oldOvcThumbprints = @(
  "2C875078EE38009479F27969EEEE1C1769505C8CEE46FDA2CDF6D9D5D963A9D6",
  "3E780318E2641D79800E2160E8C0D0FCBB22672241AAC1825DC251B7A2C4418A"
)

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

Write-Host "Installing OVC localhost CA certificate:"
Write-Host "  Path:        $resolvedCaPath"
Write-Host "  Thumbprint:  $($caCert.Thumbprint)"
Write-Host "  Admin:       $isAdmin"

# ── Helper ────────────────────────────────────────────────────────────────────
function Invoke-WithStore($storeName, $storeLocation, [scriptblock]$action) {
  $store = New-Object System.Security.Cryptography.X509Certificates.X509Store(
    $storeName, $storeLocation
  )
  $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
  try { & $action $store }
  finally { $store.Close() }
}

# ── Remove stale OVC certificates ─────────────────────────────────────────────
$locationsToClean = @(
  @{ Store = "Root";         Location = "LocalMachine" },
  @{ Store = "Root";         Location = "CurrentUser"  },
  @{ Store = "TrustedPeople"; Location = "CurrentUser" }
)
foreach ($entry in $locationsToClean) {
  try {
    Invoke-WithStore $entry.Store $entry.Location {
      param($store)
      $stale = $store.Certificates | Where-Object {
        $oldOvcThumbprints -contains $_.Thumbprint -or
        ($_.Subject -eq "CN=OVC Localhost CA" -and $_.Thumbprint -ne $caCert.Thumbprint)
      }
      foreach ($c in $stale) { $store.Remove($c) }
    }
  } catch { <# skip stores we cannot open #> }
}

# ── Install CA certificate ─────────────────────────────────────────────────────
# Preferred path: LocalMachine\Root when running as admin.
#   - Uses .NET X509Store API directly (no certutil process, no dialog, always
#     silent when the calling process is elevated).
# Fallback: CurrentUser\Root when not admin.
#   - Windows 10/11 will show a security confirmation dialog – click YES.
$caInstalled = $false

if ($isAdmin) {
  Write-Host "  → Installing CA to LocalMachine\Root (silent, no dialog)..."
  try {
    Invoke-WithStore "Root" "LocalMachine" {
      param($store)
      $store.Add($caCert)
    }
    Write-Host "  ✓ CA installed to LocalMachine\Root"
    $caInstalled = $true
  } catch {
    Write-Warning "  LocalMachine\Root install failed: $_"
  }
}

if (-not $caInstalled) {
  $alreadyUser = Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $caCert.Thumbprint }
  if ($alreadyUser) {
    Write-Host "  ✓ CA already trusted in CurrentUser\Root"
    $caInstalled = $true
  } else {
    if (-not $isAdmin) {
      Write-Host ""
      Write-Host "  Windows will show a security dialog — click YES to trust the OVC CA."
      Write-Host ""
    }
    try {
      Invoke-WithStore "Root" "CurrentUser" {
        param($store)
        $store.Add($caCert)
      }
      Write-Host "  ✓ CA installed to CurrentUser\Root"
      $caInstalled = $true
    } catch {
      Write-Warning "  CurrentUser\Root install failed: $_"
    }
  }
}

# ── Install server cert to TrustedPeople ──────────────────────────────────────
$alreadyTP = Get-ChildItem Cert:\CurrentUser\TrustedPeople -ErrorAction SilentlyContinue |
  Where-Object { $_.Thumbprint -eq $serverCert.Thumbprint }
if (-not $alreadyTP) {
  Invoke-WithStore "TrustedPeople" "CurrentUser" {
    param($store) $store.Add($serverCert)
  }
  Write-Host "  ✓ Server cert installed to CurrentUser\TrustedPeople"
}

# ── Verify ─────────────────────────────────────────────────────────────────────
$trustedCa = @(
  Get-ChildItem Cert:\LocalMachine\Root -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $caCert.Thumbprint }
  Get-ChildItem Cert:\CurrentUser\Root  -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $caCert.Thumbprint }
) | Where-Object { $_ }

if (-not $trustedCa) {
  throw "OVC CA certificate was not installed. Re-run as Administrator, or click YES when Windows asks for confirmation."
}

Write-Host "Done. Restart Office before adding the OVC add-in."
