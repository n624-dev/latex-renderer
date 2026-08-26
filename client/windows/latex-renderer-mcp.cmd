@echo off
setlocal
if not defined LATEX_RENDER_BASE_URL set "LATEX_RENDER_BASE_URL=https://latex-render.n624.jp"
set "LATEX_RENDER_CLI_PATH=%~dp0latex-render.cmd"
for %%I in ("%~dp0..") do set "LATEX_RENDER_INSTALL_DIRECTORY=%%~fI"
node "%~dp0..\app\latex-renderer-mcp.cjs" %*
