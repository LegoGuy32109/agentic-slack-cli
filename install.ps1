param()
$ErrorActionPreference = 'Stop'
$repo = 'LegoGuy32109/agentic-slack-cli'
if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is not set.' }
if ($env:PROCESSOR_ARCHITECTURE -notin @('AMD64', 'ARM64') -and $env:PROCESSOR_ARCHITEW6432 -notin @('AMD64', 'ARM64')) {
  throw 'The release requires Windows x64 or ARM64 with x64 emulation.'
}
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
if ($release.tag_name -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$' -or $release.draft -or $release.prerelease) { throw 'No stable public release was found.' }
$name = 'slack-cli-windows-x64.exe'
$base = "https://github.com/$repo/releases/download/$($release.tag_name)"
$scratch = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
$staged = $null
New-Item -ItemType Directory -Path $scratch | Out-Null
try {
  $binary = Join-Path $scratch $name
  Invoke-WebRequest "$base/$name" -OutFile $binary -UseBasicParsing
  $sumsPath = Join-Path $scratch 'SHA256SUMS'
  Invoke-WebRequest "$base/SHA256SUMS" -OutFile $sumsPath -UseBasicParsing
  $sums = Get-Content -LiteralPath $sumsPath -Raw
  $hashes = @($sums -split '\r?\n' | ForEach-Object {
    if ($_ -match '^([a-fA-F0-9]{64})\s+\*?slack-cli-windows-x64\.exe$') { $Matches[1].ToLowerInvariant() }
  })
  if ($hashes.Count -ne 1) { throw 'Missing or ambiguous checksum.' }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $binary).Hash.ToLowerInvariant() -ne $hashes[0]) {
    throw 'Checksum mismatch. Nothing was installed.'
  }
  $binDir = Join-Path $env:LOCALAPPDATA 'slack-cli\bin'
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
  $target = Join-Path $binDir 'slack-cli.exe'
  $staged = Join-Path $binDir ('.slack-cli-' + [Guid]::NewGuid().ToString() + '.new')
  Copy-Item -LiteralPath $binary -Destination $staged
  Move-Item -LiteralPath $staged -Destination $target -Force
  Write-Host "Installed $($release.tag_name) to $target."
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $onUserPath = @($userPath -split ';' | Where-Object { $_.Trim().TrimEnd('\') -ieq $binDir.TrimEnd('\') })
  if (-not $onUserPath.Count) {
    $newUserPath = if ([string]::IsNullOrEmpty($userPath)) { $binDir } else { $userPath.TrimEnd(';') + ';' + $binDir }
    [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
  }
  Write-Host 'Open a new terminal to use slack-cli from your PATH.'
  Write-Host 'Next: slack-cli auth'
  Write-Host 'Updates: slack-cli update'
} finally {
  Remove-Item -LiteralPath $scratch -Recurse -Force
  if ($staged -and (Test-Path -LiteralPath $staged)) { Remove-Item -LiteralPath $staged -Force }
}
