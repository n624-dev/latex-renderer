[CmdletBinding()]
param(
  [string] $BaseUri = 'https://latex-render.n624.jp/downloads/client/',
  [string] $InstallDirectory = (Join-Path $env:LOCALAPPDATA 'LaTeXRenderer'),
  [ValidateSet('Both', 'Codex', 'Claude', 'None')]
  [string] $SkillTarget = 'Both',
  [switch] $SkipCredential
)

$ErrorActionPreference = 'Stop'
$minimumNodeMajor = 24
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) { throw 'Node.js 24 or newer is required.' }
$nodeVersionText = (& node --version)
if (
  $LASTEXITCODE -ne 0 -or
  $nodeVersionText -notmatch '^v(?<major>\d+)\.' -or
  [int]$Matches.major -lt $minimumNodeMajor
) {
  throw "Node.js 24 or newer is required; found $nodeVersionText."
}

$temporaryInstaller = Join-Path ([IO.Path]::GetTempPath()) (
  'install-latex-renderer-' + [guid]::NewGuid().ToString('N') + '.mjs'
  )
  try {
  $base = [Uri]$BaseUri
  $fresh = [guid]::NewGuid().ToString('N')
  Invoke-WebRequest -UseBasicParsing `
    -Uri ([Uri]::new($base, "install.mjs?fresh=$fresh")) `
    -OutFile $temporaryInstaller
  $normalizedSkillTarget = $SkillTarget.ToLowerInvariant()
  $arguments = @(
    $temporaryInstaller,
    '--base-uri', $BaseUri,
    '--install-directory', $InstallDirectory,
    '--skill-target', $normalizedSkillTarget
  )
  if ($SkipCredential) {
    & node @arguments
  } else {
    $secureKey = Read-Host 'Paste the lrk_ render API key (input is hidden)' -AsSecureString
    $plainKey = $null
    $bstr = [IntPtr]::Zero
    try {
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
      $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
      $plainKey | & node @arguments --api-key-stdin
    } finally {
      $plainKey = $null
      $secureKey = $null
      if ($bstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
      }
    }
  }
  if ($LASTEXITCODE -ne 0) { throw 'Client installation failed.' }

  $bin = Join-Path $InstallDirectory 'bin'
  Write-Output 'Restart Codex/Claude and open a new terminal before first use.'
  Write-Output "Codex MCP: codex mcp add latex-renderer -- `"$(Join-Path $bin 'latex-renderer-mcp.cmd')`""
  Write-Output "Claude MCP: claude mcp add --scope user latex-renderer -- cmd /c `"$(Join-Path $bin 'latex-renderer-mcp.cmd')`""
} finally {
  Remove-Item -LiteralPath $temporaryInstaller -Force -ErrorAction SilentlyContinue
}
