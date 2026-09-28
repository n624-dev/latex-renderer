@echo off
setlocal
for %%I in ("%~dp0..") do set "LATEX_RENDER_INSTALL_DIRECTORY=%%~fI"
node "%~dp0..\app\latex-render.cjs" %*
