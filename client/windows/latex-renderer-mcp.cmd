@echo off
setlocal
set "LATEX_RENDER_CLI_PATH=%~dp0latex-render.cmd"
for %%I in ("%~dp0..") do set "LATEX_RENDER_INSTALL_DIRECTORY=%%~fI"
node "%~dp0..\app\latex-renderer-mcp.cjs" %*
