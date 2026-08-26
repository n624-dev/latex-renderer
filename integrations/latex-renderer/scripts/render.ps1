param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string] $Project,
  [Parameter(Position = 1)]
  [string] $Entrypoint
)
$ErrorActionPreference = 'Stop'
if ($Entrypoint) {
  & latex-render render $Project --entrypoint $Entrypoint
} else {
  & latex-render render $Project
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
