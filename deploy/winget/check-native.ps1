[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('x64', 'arm64')]
    [string]$Architecture,
    [Parameter(Mandatory = $true)]
    [string]$CandidateArchive,
    [Parameter(Mandatory = $true)]
    [string]$PreviousClientArchive
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$native = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $native -ne $Architecture) {
    throw 'Run the WinGet acceptance test on a disposable GitHub-hosted Windows runner of the requested architecture.'
}

function Invoke-Checked {
    param([string]$File, [string[]]$CommandArguments)
    $result = & $File @CommandArguments
    if ($LASTEXITCODE -ne 0) {
        $result | Out-Host
        throw "$([IO.Path]::GetFileName($File)) $($CommandArguments[0]) exited with $LASTEXITCODE"
    }
    $result
}

function Get-CheckedDownload {
    param([string]$FileName, [string]$Sha256)
    $file = Join-Path $work $FileName
    Invoke-WebRequest -Uri "https://github.com/microsoft/winget-cli/releases/download/v1.29.380/$FileName" -OutFile $file -TimeoutSec 180
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $Sha256) {
        throw "Microsoft App Installer download hash mismatch for $FileName"
    }
    $file
}

function Get-WinGet {
    $existing = Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($existing) { return $existing.Source }

    $bundle = Get-CheckedDownload 'Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle' '65dea9c01ce08ee7b763366b27c0e651f97db857c11ca9b9c301826c10092f2e'
    $dependencies = Get-CheckedDownload 'DesktopAppInstaller_Dependencies.zip' 'ba875afe9d190f61218985ac0292a99d1db710bf93e13c68944ca9d89f0d82d1'
    $frameworks = Join-Path $work 'frameworks'
    Expand-Archive -LiteralPath $dependencies -DestinationPath $frameworks
    $env:N624_WINGET_BUNDLE = $bundle
    $env:N624_WINGET_FRAMEWORKS = Join-Path $frameworks $Architecture
    try {
        $install = @'
$ErrorActionPreference = 'Stop'
$dependencies = @(Get-ChildItem -LiteralPath $env:N624_WINGET_FRAMEWORKS -Filter '*.appx')
if ($dependencies.Count -ne 3) { throw 'App Installer framework archive is incomplete.' }
Add-AppxPackage -Path $env:N624_WINGET_BUNDLE -DependencyPath $dependencies.FullName
'@
        Invoke-Checked 'powershell.exe' @('-NoProfile', '-NonInteractive', '-Command', $install) | Out-Host
    } finally {
        Remove-Item Env:N624_WINGET_BUNDLE,Env:N624_WINGET_FRAMEWORKS -ErrorAction SilentlyContinue
    }
    $aliasPath = Join-Path $env:LOCALAPPDATA 'Microsoft/WindowsApps/winget.exe'
    if (!(Test-Path -LiteralPath $aliasPath)) {
        throw 'WinGet application alias is unavailable after App Installer registration.'
    }
    $aliasPath
}

function Assert-Installed {
    param([string]$Version)
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $normalized = @($userPath -split ';' | ForEach-Object {
        [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\', '/')
    })
    if ($links -notin $normalized) { throw 'WinGet did not register the user Links directory on PATH.' }
    $env:Path = "$([Environment]::GetEnvironmentVariable('Path', 'Machine'));$userPath;$originalPath"
    foreach ($name in @('n624-latex', 'latex-render', 'latex-render-admin')) {
        $command = Get-Command "$name.exe" -CommandType Application
        if ($command.Source -ne (Join-Path $links "$name.exe")) { throw "$name is missing from the WinGet PATH." }
        if ((Invoke-Checked $command.Source @('--version')).Trim() -ne $Version) {
            throw "$name did not start the expected bundled version."
        }
    }
    $status = Invoke-Checked (Join-Path $links 'n624-latex.exe') @('auth', 'status', '--json') | ConvertFrom-Json
    if (!$status.success -or !$status.result.configured) { throw 'The installed client cannot decrypt the saved key.' }
    if ((Get-FileHash -LiteralPath $credential -Algorithm SHA256).Hash -ne $credentialHash) {
        throw 'The saved DPAPI credential changed.'
    }
    if ((Get-FileHash -LiteralPath $registration -Algorithm SHA256).Hash -ne $registrationHash) {
        throw 'The existing MCP registration changed.'
    }
}

function Assert-Mcp {
    param([string]$Launcher)
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.UseShellExecute = $false
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    if ($Launcher.EndsWith('.cmd', [StringComparison]::OrdinalIgnoreCase)) {
        if ($Launcher -match '["%\r\n]') { throw 'Unexpected MCP fixture path.' }
        $info.FileName = $env:ComSpec
        $info.Arguments = '/d /s /c ""' + $Launcher + '""'
    } else {
        $info.FileName = $Launcher
    }
    $process = [Diagnostics.Process]::Start($info)
    try {
        $process.StandardInput.WriteLine('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"winget-acceptance","version":"1"}}}')
        $process.StandardInput.Flush()
        $reply = $process.StandardOutput.ReadLineAsync()
        if (!$reply.Wait(15000) -or !$reply.Result) { throw 'MCP initialization did not return a response.' }
        $data = $reply.Result | ConvertFrom-Json
        if ($data.id -ne 1 -or !$data.result.serverInfo.name) { throw 'MCP initialization returned an unexpected response.' }
    } finally {
        $process.StandardInput.Close()
        if (!$process.WaitForExit(10000)) { $process.Kill($true) }
        $process.Dispose()
    }
}

$candidate = (Get-Item -LiteralPath $CandidateArchive).FullName
$previous = (Get-Item -LiteralPath $PreviousClientArchive).FullName
$releasePattern = '[0-9]+\.[0-9]+\.[0-9]+(?:-rc\.[1-9][0-9]*)?'
$version = [regex]::Match([IO.Path]::GetFileName($candidate), "^n624-latex-($releasePattern)-windows-$Architecture\.zip$").Groups[1].Value
$previousVersion = [regex]::Match([IO.Path]::GetFileName($previous), '^latex-renderer-client-([0-9]+\.[0-9]+\.[0-9]+)\.zip$').Groups[1].Value
if (!$version -or !$previousVersion -or $version -eq $previousVersion) {
    throw 'The test needs matching native Windows and older Stable client archives.'
}

$work = Join-Path $env:RUNNER_TEMP "n624-winget-$([guid]::NewGuid())"
$null = New-Item -ItemType Directory -Path $work
$originalPath = $env:Path
$originalUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$environmentNames = @('APPDATA', 'LATEX_RENDER_API_KEY', 'LATEX_RENDER_BASE_URL')
$originalEnvironment = @{}
foreach ($name in $environmentNames) { $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name) }
$server = $null
$winget = $null
$armed = $false
$installedManifest = $null
$manifestWriter = Join-Path $PSScriptRoot 'write-manifest.mjs'
$packageBuilder = Join-Path $PSScriptRoot 'build-package.mjs'

try {
    $winget = Get-WinGet
    $links = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'
    foreach ($name in @('n624-latex', 'latex-render', 'latex-render-admin', 'latex-renderer-mcp')) {
        if (Test-Path -LiteralPath (Join-Path $links "$name.exe")) { throw "WinGet fixture path is in use: $name" }
    }

    $assets = Join-Path $work 'assets'
    $legacyTree = Join-Path $work 'old-source'
    $oldManifest = Join-Path $work 'old-manifest'
    $newManifest = Join-Path $work 'new-manifest'
    $null = New-Item -ItemType Directory -Path $assets
    Expand-Archive -LiteralPath $previous -DestinationPath $legacyTree
    $legacyPayload = Join-Path $legacyTree 'latex-renderer-client'
    if ((Get-Content -LiteralPath (Join-Path $legacyPayload 'VERSION') -Raw).Trim() -ne $previousVersion) {
        throw 'Unexpected Stable archive payload version.'
    }
    Invoke-Checked 'node' @($packageBuilder, $Architecture, $legacyPayload, $assets) | Out-Host
    Copy-Item -LiteralPath $candidate,$previous -Destination $assets
    $legacyManifest = @{
        version = $previousVersion
        archive = [IO.Path]::GetFileName($previous)
        sha256 = (Get-FileHash -LiteralPath $previous -Algorithm SHA256).Hash.ToLowerInvariant()
        size = (Get-Item -LiteralPath $previous).Length
        minimumNodeVersion = '24.0.0'
    } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $assets 'manifest.json'), $legacyManifest)

    $serverScript = @'
const { createServer } = require("node:http");
const { createReadStream, statSync, writeFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { join } = require("node:path");
const [assets, ready] = process.argv.slice(2);
const expectedKey = "lrk_" + "a".repeat(32) + "_" + "A".repeat(43);
const jobTicket = "winget-fixture-job-ticket";
const sourceId = "source_" + "0".repeat(32);
const jobId = "job_" + "0".repeat(32);
const timestamp = new Date().toISOString();
const expiresAt = new Date(Date.now() + 600_000).toISOString();
const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
const sha256 = createHash("sha256").update(pdf).digest("hex");
const api = "/api/v1";
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  const reply = (value) => response.writeHead(200, {"Content-Type":"application/json"}).end(JSON.stringify(value));
  if (/^\/(?:[a-z0-9.~_-]+\.zip|manifest\.json)$/.test(path)) {
    const file = join(assets, path.slice(1));
    response.setHeader("Content-Length", statSync(file).size);
    createReadStream(file).pipe(response);
  } else if (request.headers.authorization === "Bearer " + expectedKey && request.method === "POST") {
    request.resume();
    if (path === api + "/source-tickets") reply({sourceId, uploadRequired:false, expiresAt});
    else if (path === api + "/render-tickets") reply({jobId, jobTicket, expiresAt});
    else response.writeHead(404).end();
  } else if (request.headers.authorization === "Bearer " + jobTicket) {
    const jobPath = api + "/jobs/" + jobId;
    const downloadUrl = jobPath + "/artifacts/result.pdf";
    if (path === jobPath) reply({
      id:jobId, status:"succeeded", sourceSize:1, sourceSha256:"0".repeat(64),
      createdAt:timestamp, updatedAt:timestamp, errorCode:null, errorMessage:null,
      retentionExpiresAt:null, previews:[],
      artifacts:[{relativePath:"result.pdf", type:"pdf", size:pdf.length, sha256, createdAt:timestamp, downloadUrl}]
    });
    else if (path === downloadUrl) response.end(pdf);
    else response.writeHead(404).end();
  } else response.writeHead(404).end();
});
server.listen(0, "127.0.0.1", () => writeFileSync(ready, String(server.address().port)));
'@
    $fixtureScript = Join-Path $work 'fixture.cjs'
    $portFile = Join-Path $work 'port'
    [IO.File]::WriteAllText($fixtureScript, $serverScript)
    $info = [Diagnostics.ProcessStartInfo]::new((Get-Command node -CommandType Application).Source)
    $info.UseShellExecute = $false
    foreach ($argument in @($fixtureScript, $assets, $portFile)) { $info.ArgumentList.Add($argument) }
    $server = [Diagnostics.Process]::Start($info)
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        if ((Test-Path -LiteralPath $portFile) -or $server.HasExited) { break }
        Start-Sleep -Milliseconds 100
    }
    $port = (Get-Content -LiteralPath $portFile -Raw).Trim()
    if ($port -notmatch '^[1-9][0-9]{0,4}$') { throw 'The local acceptance fixture did not start.' }
    $origin = "http://127.0.0.1:$port/"

    foreach ($manifest in @(
        @{ ArchiveVersion = $previousVersion; PackageVersion = '0.0.1'; Directory = $oldManifest },
        @{ ArchiveVersion = $version; PackageVersion = '0.0.2'; Directory = $newManifest }
    )) {
        Invoke-Checked 'node' @($manifestWriter, $manifest.ArchiveVersion, $assets, $manifest.Directory,
            '--test-origin', $origin, '--test-version', $manifest.PackageVersion, '--test-architecture', $Architecture) | Out-Host
        Invoke-Checked $winget @('validate', '--manifest', $manifest.Directory) | Out-Host
    }

    $env:APPDATA = Join-Path $work 'profile'
    $env:LATEX_RENDER_BASE_URL = $origin
    Remove-Item Env:LATEX_RENDER_API_KEY -ErrorAction SilentlyContinue
    $installation = Join-Path $work 'legacy'
    $legacyBin = Join-Path $work 'legacy-bin'
    $fixtureKey = "lrk_$('a' * 32)_$('A' * 43)"
    $fixtureKey | & node (Join-Path $legacyPayload 'install.mjs') --base-uri $origin --install-directory $installation --bin-directory $legacyBin --skill-target none --mcp-target none --api-key-stdin | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The verified prior legacy installer failed.' }
    $credential = Join-Path $env:APPDATA 'latex-renderer/credential.bin'
    if ([Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($credential)).Contains($fixtureKey)) {
        throw 'The prior client wrote a plaintext API key.'
    }
    $credentialHash = (Get-FileHash -LiteralPath $credential -Algorithm SHA256).Hash
    # The absolute launcher in an existing registration should remain usable
    # after migration, even while the WinGet alias runs a different version.
    $legacyMcp = Join-Path $legacyBin 'latex-renderer-mcp.cmd'
    $registration = Join-Path $work 'codex-config.toml'
    [IO.File]::WriteAllText($registration, "[mcp_servers.latex-renderer]`ncommand = $($legacyMcp | ConvertTo-Json -Compress)`n")
    $registrationHash = (Get-FileHash -LiteralPath $registration -Algorithm SHA256).Hash
    Assert-Mcp $legacyMcp

    Invoke-Checked $winget @('settings', '--enable', 'LocalManifestFiles') | Out-Host
    $armed = $true
    $installationOptions = @('--scope', 'user', '--architecture', $Architecture, '--silent',
        '--disable-interactivity', '--accept-package-agreements', '--accept-source-agreements')
    $installedManifest = $oldManifest
    Invoke-Checked $winget (@('install', '--manifest', $installedManifest) + $installationOptions) | Out-Host
    Assert-Installed $previousVersion

    Invoke-Checked $winget (@('upgrade', '--manifest', $newManifest) + $installationOptions) | Out-Host
    $installedManifest = $newManifest
    Assert-Installed $version
    Assert-Mcp (Join-Path $links 'latex-renderer-mcp.exe')
    Assert-Mcp $legacyMcp

    $project = Join-Path $work 'project'
    $null = New-Item -ItemType Directory -Path $project
    [IO.File]::WriteAllText((Join-Path $project 'main.tex'), '\documentclass{article}\begin{document}WinGet\end{document}')
    Push-Location $project
    try {
        Invoke-Checked (Join-Path $links 'n624-latex.exe') @('main.tex') | Out-Host
        if ((Get-Content -LiteralPath 'main.pdf' -TotalCount 1) -ne '%PDF-1.4') {
            throw 'The installed CLI did not save the PDF from the configured test server.'
        }
    } finally {
        Pop-Location
    }

    Invoke-Checked $winget @('uninstall', '--manifest', $installedManifest, '--silent', '--disable-interactivity', '--accept-source-agreements') | Out-Host
    $installedManifest = $null
    foreach ($name in @('n624-latex', 'latex-render', 'latex-render-admin', 'latex-renderer-mcp')) {
        if (Test-Path -LiteralPath (Join-Path $links "$name.exe")) { throw "WinGet left a launcher on PATH: $name" }
    }
    if ((Get-FileHash -LiteralPath $credential -Algorithm SHA256).Hash -ne $credentialHash -or
        (Get-FileHash -LiteralPath $registration -Algorithm SHA256).Hash -ne $registrationHash) {
        throw 'Uninstall changed the existing credential or MCP registration.'
    }
    Assert-Mcp $legacyMcp
    Write-Output "WinGet install, upgrade, same-user credential and MCP migration, and uninstall passed on $Architecture."
} finally {
    if ($installedManifest) {
        & $winget uninstall --manifest $installedManifest --silent --disable-interactivity --accept-source-agreements | Out-Host
    }
    if ($armed) { & $winget settings --disable LocalManifestFiles | Out-Host }
    if ($server) {
        if (!$server.HasExited) { $server.Kill($true); $server.WaitForExit() }
        $server.Dispose()
    }
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name])
    }
    [Environment]::SetEnvironmentVariable('Path', $originalUserPath, 'User')
    $env:Path = $originalPath
    Remove-Item -LiteralPath $work -Recurse -Force
}
