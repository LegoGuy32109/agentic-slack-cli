# Offline installer checks. Downloads are fixtures, never real executables.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install.ps1'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('slack-install-test-' + [Guid]::NewGuid())
$oldLocalAppData = $env:LOCALAPPDATA
$oldArchitecture = $env:PROCESSOR_ARCHITECTURE
$oldWowArchitecture = $env:PROCESSOR_ARCHITEW6432
$oldUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$isWindowsHost = $env:OS -eq 'Windows_NT'
$global:SlackInstallTestMode = 'valid'
$global:SlackInstallTestDownloadFolders = @()
$global:SlackInstallTestRequests = @()
$global:SlackInstallTestBytes = [Text.Encoding]::UTF8.GetBytes('fixture release binary')
$sha = [Security.Cryptography.SHA256]::Create()
try { $global:SlackInstallTestHash = [BitConverter]::ToString($sha.ComputeHash($global:SlackInstallTestBytes)).Replace('-', '').ToLowerInvariant() }
finally { $sha.Dispose() }

function Assert-True($condition, $message) {
  if (-not $condition) { throw $message }
}
function Invoke-RestMethod($Uri) {
  $global:SlackInstallTestRequests += $Uri
  Assert-True ($Uri -eq 'https://api.github.com/repos/LegoGuy32109/agentic-slack-cli/releases/latest') 'Unexpected release endpoint.'
  return [pscustomobject]@{ tag_name = 'v2.0.0'; draft = $false; prerelease = ($global:SlackInstallTestMode -eq 'prerelease') }
}
function Invoke-WebRequest($Uri, $OutFile, [switch]$UseBasicParsing) {
  $global:SlackInstallTestRequests += $Uri
  Assert-True ($Uri.StartsWith('https://github.com/LegoGuy32109/agentic-slack-cli/releases/download/v2.0.0/')) 'Download must pin the selected release.'
  if ($OutFile) {
    $global:SlackInstallTestDownloadFolders += Split-Path $OutFile
    [IO.File]::WriteAllBytes($OutFile, $global:SlackInstallTestBytes)
    return
  }
  $line = "$global:SlackInstallTestHash  slack-cli-windows-x64.exe"
  switch ($global:SlackInstallTestMode) {
    'mismatch' { $line = ('0' * 64) + '  slack-cli-windows-x64.exe' }
    'missing' { $line = "$global:SlackInstallTestHash  other.exe" }
    'ambiguous' { $line = $line + "`n" + $line }
  }
  return [pscustomobject]@{ Content = $line }
}
function Expect-Failure($pattern) {
  $caught = $false
  try { & $installer } catch {
    $caught = $true
    Assert-True ($_.Exception.Message -match $pattern) "Unexpected failure: $($_.Exception.Message)"
  }
  Assert-True $caught "Expected failure matching $pattern."
}

New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
try {
  $env:LOCALAPPDATA = $fixtureRoot
  $env:PROCESSOR_ARCHITECTURE = 'AMD64'
  $env:PROCESSOR_ARCHITEW6432 = $null
  $binDir = Join-Path $fixtureRoot 'slack-cli\bin'
  $target = Join-Path $binDir 'slack-cli.exe'
  & $installer
  Assert-True ((Get-FileHash -Algorithm SHA256 $target).Hash.ToLowerInvariant() -eq $global:SlackInstallTestHash) 'Installed bytes differ from verified bytes.'
  if ($isWindowsHost) {
    $installedPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    Assert-True (($installedPath -split ';') -contains $binDir) 'Installer did not add the user PATH.'
    if ($oldUserPath) { Assert-True ($installedPath.StartsWith($oldUserPath.TrimEnd(';') + ';')) 'Existing user PATH was changed.' }
  }
  & $installer
  if ($isWindowsHost) {
    Assert-True ([Environment]::GetEnvironmentVariable('Path', 'User') -eq $installedPath) 'Reinstall duplicated the PATH entry.'
  }
  foreach ($mode in @('mismatch', 'missing', 'ambiguous', 'prerelease')) {
    $global:SlackInstallTestMode = $mode
    $pattern = if ($mode -eq 'mismatch') { 'Checksum mismatch' } elseif ($mode -eq 'prerelease') { 'No stable public release' } else { 'Missing or ambiguous checksum' }
    Expect-Failure $pattern
    Assert-True ((Get-FileHash -Algorithm SHA256 $target).Hash.ToLowerInvariant() -eq $global:SlackInstallTestHash) 'Rejected release replaced the installed binary.'
  }
  $global:SlackInstallTestMode = 'valid'
  $env:PROCESSOR_ARCHITECTURE = 'x86'
  $requestsBefore = $global:SlackInstallTestRequests.Count
  Expect-Failure 'requires Windows x64'
  Assert-True ($global:SlackInstallTestRequests.Count -eq $requestsBefore) 'Unsupported architecture made a request.'
  foreach ($folder in $global:SlackInstallTestDownloadFolders) { Assert-True (-not (Test-Path -LiteralPath $folder)) 'Temporary download was left behind.' }
  Assert-True (@(Get-ChildItem -LiteralPath $binDir -Filter '*.new').Count -eq 0) 'Staged file was left behind.'
  Write-Host 'PASS: verified install, reinstall, rejected checksums, stable release guard, architecture guard, and cleanup.'
  if ($isWindowsHost) { Write-Host 'PASS: user PATH preserved and not duplicated.' }
  else { Write-Host 'SKIP: Windows user PATH persistence requires a Windows host.' }
} finally {
  $env:LOCALAPPDATA = $oldLocalAppData
  $env:PROCESSOR_ARCHITECTURE = $oldArchitecture
  $env:PROCESSOR_ARCHITEW6432 = $oldWowArchitecture
  if ($isWindowsHost) { [Environment]::SetEnvironmentVariable('Path', $oldUserPath, 'User') }
  Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  Remove-Variable -Scope Global -Name SlackInstallTestMode,SlackInstallTestDownloadFolders,SlackInstallTestRequests,SlackInstallTestBytes,SlackInstallTestHash
}
