@echo off
cd /d "%~dp0"
if exist "%USERPROFILE%\anaconda3\python.exe" (
  "%USERPROFILE%\anaconda3\python.exe" serve.py
  goto :end
)
where py >nul 2>nul
if not errorlevel 1 (
  py -3 serve.py
  goto :end
)
where python >nul 2>nul
if not errorlevel 1 (
  python serve.py
  goto :end
)
echo Python 3 is required for the local offline server. No Python packages are needed.
:end
pause
