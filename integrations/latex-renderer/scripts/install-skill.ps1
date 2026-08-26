param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('codex', 'claude', 'both')]
  [string] $Target
)

$ErrorActionPreference = 'Stop'
$installer = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'install-skill.mjs'
& node $installer --action install --target $Target
if ($LASTEXITCODE -ne 0) { throw 'Skill installation failed.' }
