param(
  [string]$BaseUrl = "http://127.0.0.1:3000/dispenser/"
)

$ErrorActionPreference = "Stop"
$page = Invoke-WebRequest -Uri $BaseUrl -UseBasicParsing
$csp = [string]$page.Headers["Content-Security-Policy"]

if ($csp -match "(?:^|;)\s*upgrade-insecure-requests(?:;|$)") {
  throw "The server is forcing HTTP assets to HTTPS. This breaks LAN access unless IIS has a trusted HTTPS certificate."
}

$scriptMatch = [regex]::Match($page.Content, 'src="([^"]+\.js)"')
if (-not $scriptMatch.Success) {
  throw "The dispenser page does not reference a JavaScript bundle."
}

$assetUrl = [Uri]::new([Uri]$BaseUrl, $scriptMatch.Groups[1].Value).AbsoluteUri
$asset = Invoke-WebRequest -Uri $assetUrl -UseBasicParsing
if ($asset.StatusCode -ne 200 -or $asset.Headers["Content-Type"] -notmatch "javascript") {
  throw "The JavaScript bundle was not served correctly: $assetUrl"
}

Write-Host "LAN HTTP verification passed: page and JavaScript bundle are available without an HTTPS upgrade."
