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

function Test-WinGet {
    param([string]$File)
    if (!(Test-Path -LiteralPath $File)) { return $false }
    try {
        $probe = & $File --version 2>$null
        return $LASTEXITCODE -eq 0 -and ($probe -join '') -match '^v?\d+\.\d+'
    } catch {
        return $false
    }
}

function Get-WinGet {
    $existing = Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing -and (Test-WinGet $existing.Source)) { return $existing.Source }

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
$appx = @{ Path = $env:N624_WINGET_BUNDLE; DependencyPath = $dependencies.FullName }
try {
    Add-AppxPackage @appx
} catch {
    if (($_ | Out-String) -notmatch '0x80073D02') { throw }
    # This test only runs on a disposable hosted runner. The desktop may
    # already be using a framework required by the pinned App Installer.
    Write-Warning 'Installing App Installer requires closing applications that are using its framework dependencies.'
    Add-AppxPackage @appx -ForceApplicationShutdown
}
'@
        Invoke-Checked 'powershell.exe' @('-NoProfile', '-NonInteractive', '-Command', $install) | Out-Host
    } finally {
        Remove-Item Env:N624_WINGET_BUNDLE,Env:N624_WINGET_FRAMEWORKS -ErrorAction SilentlyContinue
    }
    $aliasPath = Join-Path $env:LOCALAPPDATA 'Microsoft/WindowsApps/winget.exe'
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        if (Test-WinGet $aliasPath) { return $aliasPath }
        Start-Sleep -Seconds 1
    }
    throw 'WinGet application alias is unavailable after App Installer registration.'
}

function Assert-NativeExecutable {
    param([string]$File)
    $resolved = [IO.File]::ResolveLinkTarget($File, $true)
    if ($resolved) { $File = $resolved.FullName }
    $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($File))
    try {
        if ($reader.ReadUInt16() -ne 0x5a4d) { throw 'Invalid executable DOS header.' }
        $reader.BaseStream.Position = 0x3c
        $reader.BaseStream.Position = $reader.ReadUInt32()
        if ($reader.ReadUInt32() -ne 0x00004550) { throw 'Invalid executable PE header.' }
        $expected = @{ x64 = 0x8664; arm64 = 0xaa64 }
        if ($reader.ReadUInt16() -ne $expected[$Architecture]) {
            throw "The package executable is not native $Architecture`: $File"
        }
    } finally {
        $reader.Dispose()
    }
}

function Assert-Installed {
    param([string]$Version)
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $normalized = @($userPath -split ';' | ForEach-Object {
        [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\', '/')
    })
    if ($links -notin $normalized) { throw 'WinGet did not register the user Links directory on PATH.' }
    $env:Path = "$fixtureBin;$([Environment]::GetEnvironmentVariable('Path', 'Machine'));$userPath;$originalPath"
    foreach ($name in @('n624-latex', 'latex-render', 'latex-render-admin')) {
        $command = Get-Command "$name.exe" -CommandType Application | Select-Object -First 1
        if ($command.Source -ne (Join-Path $links "$name.exe")) { throw "$name is missing from the WinGet PATH." }
        Assert-NativeExecutable $command.Source
        if ((Invoke-Checked $command.Source @('--version')).Trim() -ne $Version) {
            throw "$name did not start the expected bundled version."
        }
    }
    $mcpPath = Join-Path $links 'latex-renderer-mcp.exe'
    Assert-NativeExecutable $mcpPath
    $executable = [IO.File]::ResolveLinkTarget($mcpPath, $true)
    if (!$executable) { throw 'WinGet did not create its expected launcher link.' }
    Assert-NativeExecutable (Join-Path $executable.DirectoryName 'runtime\node.exe')
    $status = Invoke-Checked (Join-Path $links 'n624-latex.exe') @('auth', 'status', '--json') | ConvertFrom-Json
    if (!$status.success -or !$status.result.configured) { throw 'The installed client cannot decrypt the saved key.' }
    if ((Get-FileHash -LiteralPath $credential -Algorithm SHA256).Hash -ne $credentialHash) {
        throw 'The saved DPAPI credential changed.'
    }
}

function Assert-ClientPath {
    $entries = @(Get-Command n624-latex -All -CommandType Application)
    $managed = Join-Path $links 'n624-latex.exe'
    $legacy = Join-Path $legacyInstall 'bin\n624-latex.cmd'
    if ($managed -notin $entries.Source -or $legacy -notin $entries.Source) {
        throw 'The WinGet and legacy clients were not both discoverable in the refreshed shell.'
    }
    if ($entries[0].Source -ne $managed) {
        if ($entries[0].Source -ne $legacy) { throw 'An unrelated application shadows n624-latex.' }
        Write-Output 'The existing legacy PATH entry takes priority. Verifying the documented explicit WinGet launcher.'
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

function Assert-Registration {
    param([string]$File, [string]$ExpectedLauncher, [switch]$Legacy)
    $entry = Get-Content -LiteralPath $File -Raw | ConvertFrom-Json
    if (!$entry.enabled -or $entry.transport.type -ne 'stdio') {
        throw 'The fixture does not have an enabled stdio MCP registration.'
    }
    if ($Legacy) {
        if ($entry.transport.command -ne 'cmd' -or $entry.transport.args.Count -ne 2 -or
            $entry.transport.args[0] -ne '/c' -or $entry.transport.args[1] -ne $ExpectedLauncher) {
            throw 'The existing Codex registration does not use the legacy installer launcher.'
        }
    } elseif ($entry.transport.command -ne $ExpectedLauncher -or $entry.transport.args.Count -ne 0) {
        throw 'The new Codex registration does not use the stable WinGet launcher.'
    }
    Assert-Mcp $ExpectedLauncher
}

function New-CodexFixture {
    $null = New-Item -ItemType Directory -Path $fixtureBin
    $fixtureSource = Join-Path $work 'codex-fixture.go'
    [IO.File]::WriteAllText($fixtureSource, @'
package main

import (
    "encoding/json"
    "fmt"
    "os"
    "slices"
)

type transport struct {
    Type string `json:"type"`
    Command string `json:"command"`
    Args []string `json:"args"`
}

type registration struct {
    Enabled bool `json:"enabled"`
    Transport transport `json:"transport"`
}

func main() {
    if err := run(os.Args[1:], os.Getenv("FIXTURE_MCP_STATE")); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}

func run(args []string, state string) error {
    if state == "" {
        return fmt.Errorf("missing Codex fixture state path")
    }
    switch {
    case slices.Equal(args, []string{"--version"}):
        fmt.Println("Codex test fixture 1")
    case slices.Equal(args, []string{"mcp", "get", "latex-renderer", "--json"}):
        bytes, err := os.ReadFile(state)
        if os.IsNotExist(err) {
            return fmt.Errorf("No MCP server found")
        }
        if err != nil {
            return err
        }
        // Model Codex's public get output without unrelated configuration.
        var entry registration
        if err := json.Unmarshal(bytes, &entry); err != nil {
            return err
        }
        return json.NewEncoder(os.Stdout).Encode(entry)
    case len(args) >= 5 && slices.Equal(args[:4], []string{"mcp", "add", "latex-renderer", "--"}):
        entry := registration{true, transport{"stdio", args[4], args[5:]}}
        bytes, err := json.Marshal(entry)
        if err != nil {
            return err
        }
        file, err := os.OpenFile(state, os.O_WRONLY | os.O_CREATE | os.O_EXCL, 0600)
        if err != nil {
            return err
        }
        defer file.Close()
        _, err = file.Write(bytes)
        return err
    case slices.Equal(args, []string{"mcp", "remove", "latex-renderer"}):
        return os.Remove(state)
    default:
        return fmt.Errorf("unexpected Codex fixture arguments: %q", args)
    }
    return nil
}
'@)
    Invoke-Checked 'go' @('build', '-o', (Join-Path $fixtureBin 'codex.exe'), $fixtureSource) | Out-Host
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
$environmentNames = @('APPDATA', 'LATEX_RENDER_API_KEY', 'LATEX_RENDER_BASE_URL', 'FIXTURE_MCP_STATE')
$originalEnvironment = @{}
foreach ($name in $environmentNames) { $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name) }
$server = $null
$winget = $null
$armed = $false
$installedManifest = $null
$legacyInstall = Join-Path $env:LOCALAPPDATA 'LaTeXRenderer'
$ownsLegacyInstall = $false
$fixtureBin = Join-Path $work 'fixture-bin'
$manifestWriter = Join-Path $PSScriptRoot 'write-manifest.mjs'
$packageBuilder = Join-Path $PSScriptRoot 'build-package.mjs'

try {
    $winget = Get-WinGet
    if (Test-Path -LiteralPath $legacyInstall) { throw 'The fixture cannot overwrite an existing legacy installation.' }
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
    $node = Get-Command node.exe -CommandType Application | Select-Object -First 1
    $info = [Diagnostics.ProcessStartInfo]::new($node.Source)
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
    New-CodexFixture
    $env:Path = "$fixtureBin;$originalPath"
    $legacyRegistration = Join-Path $work 'legacy-mcp.json'
    $env:FIXTURE_MCP_STATE = $legacyRegistration
    Remove-Item Env:LATEX_RENDER_API_KEY -ErrorAction SilentlyContinue
    $ownsLegacyInstall = $true
    $fixtureKey = "lrk_$('a' * 32)_$('A' * 43)"
    $fixtureKey | & node (Join-Path $legacyPayload 'install.mjs') --base-uri $origin --skill-target none --mcp-target codex --api-key-stdin --json | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The verified prior legacy installer failed.' }
    $credential = Join-Path $env:APPDATA 'latex-renderer/credential.bin'
    if ([Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($credential)).Contains($fixtureKey)) {
        throw 'The prior client wrote a plaintext API key.'
    }
    $credentialHash = (Get-FileHash -LiteralPath $credential -Algorithm SHA256).Hash
    $legacyMcp = Join-Path $legacyInstall 'bin\latex-renderer-mcp.cmd'
    Assert-Registration $legacyRegistration $legacyMcp -Legacy
    $customized = Get-Content -LiteralPath $legacyRegistration -Raw | ConvertFrom-Json -AsHashtable
    $customized['tool_timeout_sec'] = 120
    $customized['enabled_tools'] = @('render', 'get_job')
    [IO.File]::WriteAllText($legacyRegistration, ($customized | ConvertTo-Json -Depth 10))
    $legacyRegistrationHash = (Get-FileHash -LiteralPath $legacyRegistration -Algorithm SHA256).Hash

    Invoke-Checked $winget @('settings', '--enable', 'LocalManifestFiles') | Out-Host
    $armed = $true
    $installationOptions = @('--scope', 'user', '--architecture', $Architecture, '--silent',
        '--disable-interactivity', '--accept-package-agreements', '--accept-source-agreements')
    $installedManifest = $oldManifest
    Invoke-Checked $winget (@('install', '--manifest', $installedManifest) + $installationOptions) | Out-Host
    Assert-Installed $previousVersion
    $managedCli = Join-Path $links 'n624-latex.exe'
    $managedMcp = Join-Path $links 'latex-renderer-mcp.exe'

    Invoke-Checked $winget (@('upgrade', '--manifest', $newManifest) + $installationOptions) | Out-Host
    $installedManifest = $newManifest
    Assert-Installed $version
    Assert-ClientPath
    $setupArgs = @('setup', 'integrations', '--mcp-target', 'codex', '--skill-target', 'none', '--json')
    $preserved = Invoke-Checked $managedCli $setupArgs | ConvertFrom-Json
    if (!$preserved.success -or 'mcp:codex:conflict' -notin $preserved.result.preserved -or
        (Get-FileHash -LiteralPath $legacyRegistration -Algorithm SHA256).Hash -ne $legacyRegistrationHash) {
        throw 'Explicit AI integration setup did not preserve the existing customized Codex registration.'
    }
    Assert-Registration $legacyRegistration $legacyMcp -Legacy
    $managedRegistration = Join-Path $work 'managed-mcp.json'
    $env:FIXTURE_MCP_STATE = $managedRegistration
    $fresh = Invoke-Checked $managedCli $setupArgs | ConvertFrom-Json
    if (!$fresh.success -or 'mcp:codex' -notin $fresh.result.repaired) {
        throw 'Explicit AI integration setup did not register Codex with the WinGet launcher.'
    }
    Assert-Registration $managedRegistration $managedMcp
    $managedRegistrationHash = (Get-FileHash -LiteralPath $managedRegistration -Algorithm SHA256).Hash
    $existingAppData = $env:APPDATA
    try {
        $env:APPDATA = Join-Path $work 'new-profile'
        $null = New-Item -ItemType Directory -Path $env:APPDATA
        $login = $fixtureKey | & $managedCli setup --api-key-stdin --json | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or !$login.success -or !$login.result.configured) {
            throw 'A fresh Windows user profile could not save an API key with the packaged client.'
        }
        $freshStatus = Invoke-Checked $managedCli @('auth', 'status', '--json') | ConvertFrom-Json
        if (!$freshStatus.success -or !$freshStatus.result.configured) {
            throw 'A fresh Windows user profile could not reload the packaged client key.'
        }
        $freshCredential = Join-Path $env:APPDATA 'latex-renderer\credential.bin'
        if ([Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($freshCredential)).Contains($fixtureKey)) {
            throw 'The packaged client wrote a plaintext API key.'
        }
    } finally {
        $env:APPDATA = $existingAppData
    }

    $project = Join-Path $work 'project'
    $null = New-Item -ItemType Directory -Path $project
    [IO.File]::WriteAllText((Join-Path $project 'main.tex'), '\documentclass{article}\begin{document}WinGet\end{document}')
    Push-Location $project
    try {
        Invoke-Checked $managedCli @('main.tex') | Out-Host
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
        (Get-FileHash -LiteralPath $legacyRegistration -Algorithm SHA256).Hash -ne $legacyRegistrationHash -or
        (Get-FileHash -LiteralPath $managedRegistration -Algorithm SHA256).Hash -ne $managedRegistrationHash) {
        throw 'Uninstall changed the existing credential or MCP registration.'
    }
    Assert-Registration $legacyRegistration $legacyMcp -Legacy
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
    if ($ownsLegacyInstall) { Remove-Item -LiteralPath $legacyInstall -Recurse -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $work -Recurse -Force
}
