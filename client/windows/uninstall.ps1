[CmdletBinding()]
param(
  [string] $BaseUri = 'https://latex-render.n624.jp/downloads/client/',
  [string] $InstallDirectory = (Join-Path $env:LOCALAPPDATA 'LaTeXRenderer'),
  [switch] $KeepCredential,
  [switch] $KeepSkills
)

$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) { throw 'Node.js 24 or newer is required.' }

$temporaryUninstaller = Join-Path ([IO.Path]::GetTempPath()) (
  'uninstall-latex-renderer-' + [guid]::NewGuid().ToString('N') + '.mjs'
)
try {
  $base = [Uri]$BaseUri
  $fresh = [guid]::NewGuid().ToString('N')
  Invoke-WebRequest -UseBasicParsing `
    -Uri ([Uri]::new($base, "uninstall.mjs?fresh=$fresh")) `
    -OutFile $temporaryUninstaller
  $arguments = @($temporaryUninstaller, '--install-directory', $InstallDirectory)
  if ($KeepCredential) { $arguments += '--keep-credential' }
  if ($KeepSkills) { $arguments += '--keep-skills' }
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw 'Client uninstallation failed.' }
} finally {
  Remove-Item -LiteralPath $temporaryUninstaller -Force -ErrorAction SilentlyContinue
}
