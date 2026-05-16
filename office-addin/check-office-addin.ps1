$ErrorActionPreference = "Stop"

$api = "https://localhost:38655/api/health"
$taskpane = "https://localhost:38655/addin/taskpane.html"
$shareName = "OVCOfficeAddinCatalog"
$catalogUnc = "\\$env:COMPUTERNAME\$shareName"
$catalogRegistryPath = "HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\{c8e4cc1a-13dd-49be-90d9-5a8c24f4f7bb}"
$allowedDomainsPath = "HKCU:\Software\Microsoft\Office\16.0\WEF\AllowedAppDomains"
$policyPaths = @(
  "HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs",
  "HKCU:\Software\Policies\Microsoft\Office\16.0\WEF\TrustedCatalogs",
  "HKLM:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs",
  "HKLM:\Software\Policies\Microsoft\Office\16.0\WEF\TrustedCatalogs"
)
$caPath = Join-Path $PSScriptRoot "certs\ovc-localhost-ca.crt"
$serverPath = Join-Path $PSScriptRoot "certs\ovc-localhost.crt"
$caCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2((Resolve-Path $caPath))
$serverCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2((Resolve-Path $serverPath))

Write-Host "OVC Office add-in check"
Write-Host "CA thumbprint:     $($caCert.Thumbprint)"
Write-Host "Server thumbprint: $($serverCert.Thumbprint)"
Write-Host ""

$rootHit = (Get-ChildItem Cert:\LocalMachine\Root -ErrorAction SilentlyContinue |
            Where-Object { $_.Thumbprint -eq $caCert.Thumbprint }) +
           (Get-ChildItem Cert:\CurrentUser\Root  -ErrorAction SilentlyContinue |
            Where-Object { $_.Thumbprint -eq $caCert.Thumbprint })
$serverHit = Get-ChildItem Cert:\CurrentUser\TrustedPeople | Where-Object { $_.Thumbprint -eq $serverCert.Thumbprint }

if ($rootHit) {
  Write-Host "OK   CA is trusted (LocalMachine\Root or CurrentUser\Root)"
} else {
  Write-Host "FAIL CA is not trusted in either LocalMachine\Root or CurrentUser\Root"
}

if ($serverHit) {
  Write-Host "OK   Server certificate is in CurrentUser\TrustedPeople"
} else {
  Write-Host "FAIL Server certificate is not in CurrentUser\TrustedPeople"
}

Write-Host ""
Write-Host "Checking Office trusted add-in catalog:"

$catalog = Get-ItemProperty -Path $catalogRegistryPath -ErrorAction SilentlyContinue
if ($catalog -and $catalog.Url -eq $catalogUnc -and $catalog.Flags -eq 1) {
  Write-Host "OK   Office trusted catalog registry entry exists: $($catalog.Url)"
} else {
  Write-Host "FAIL Office trusted catalog registry entry is missing or different"
  Write-Host "     Run setup-office-addin.ps1 and approve the Administrator prompt."
}

$share = Get-SmbShare -Name $shareName -ErrorAction SilentlyContinue
if ($share) {
  Write-Host "OK   Local catalog share exists: $catalogUnc"
} else {
  Write-Host "FAIL Local catalog share was not found: $catalogUnc"
}

$allowedDomain = Get-ItemProperty -Path $allowedDomainsPath -Name "OVC" -ErrorAction SilentlyContinue
if ($allowedDomain -and $allowedDomain.OVC -eq "https://localhost:38655") {
  Write-Host "OK   Office allowed domain is registered"
} else {
  Write-Host "FAIL Office allowed domain is missing"
}

Write-Host ""
Write-Host "Checking Office web add-in policies:"

$blocked = $false
foreach ($path in $policyPaths) {
  $props = Get-ItemProperty -Path $path -ErrorAction SilentlyContinue
  if (-not $props) {
    continue
  }

  foreach ($name in @("disableallcatalogs", "disableomexcatalogs")) {
    if ($props.PSObject.Properties.Name -contains $name -and $props.$name -eq 1) {
      Write-Host "FAIL $path\$name is set to 1"
      $blocked = $true
    }
  }
}

if (-not $blocked) {
  Write-Host "OK   No blocking WEF catalog policy was found"
}

Write-Host ""
Write-Host "Checking Office WebView loopback exemption:"

$loopback = CheckNetIsolation LoopbackExempt -s
if ($loopback -match "microsoft\.win32webviewhost_cw5n1h2txyewy") {
  Write-Host "OK   Desktop App Web Viewer loopback exemption exists"
} else {
  Write-Host "FAIL Desktop App Web Viewer loopback exemption was not found"
  Write-Host '     Run PowerShell as Administrator: CheckNetIsolation LoopbackExempt -a -n="microsoft.win32webviewhost_cw5n1h2txyewy"'
}

Write-Host ""
Write-Host "Checking local OVC HTTPS service:"
Write-Host $api

try {
  $response = Invoke-WebRequest -Uri $api -UseBasicParsing -TimeoutSec 5
  Write-Host "OK   HTTPS service responded with status $($response.StatusCode)"
  Write-Host $response.Content
} catch {
  Write-Host "FAIL HTTPS service did not respond cleanly."
  Write-Host $_.Exception.Message
  Write-Host ""
  Write-Host "Make sure the OVC desktop app is open, then run this script again."
}

Write-Host ""
Write-Host "Checking task pane page:"
Write-Host $taskpane

try {
  $response = Invoke-WebRequest -Uri $taskpane -UseBasicParsing -TimeoutSec 5
  Write-Host "OK   Task pane page responded with status $($response.StatusCode)"
} catch {
  Write-Host "FAIL Task pane page did not respond cleanly."
  Write-Host $_.Exception.Message
}

Write-Host ""
Write-Host "If Office has no Shared Folder tab, use the fallback path:"
Write-Host "  Add-ins > More Add-ins > My Add-ins > Add a custom add-in > Add from file"
Write-Host "Then choose:"
Write-Host "  $PSScriptRoot\manifest.xml"
