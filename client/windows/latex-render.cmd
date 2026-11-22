@echo off
setlocal
if /I "%~n0"=="n624-latex" set "N624_LATEX_COMMAND=1"
for %%I in ("%~dp0..") do set "LATEX_RENDER_INSTALL_DIRECTORY=%%~fI"
node "%~dp0..\app\latex-render.cjs" %*
