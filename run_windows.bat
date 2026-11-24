@echo off
setlocal
cd /d "%~dp0"

echo ======================================
echo CellScope - Windows Launcher (uv)
echo ======================================

where uv >nul 2>&1
if errorlevel 1 (
    echo [ERROR] uv was not found.
    goto error
)

if not exist "app.py" (
    echo [ERROR] app.py was not found.
    goto error
)

if not exist "requirements.txt" (
    echo [ERROR] requirements.txt was not found.
    goto error
)

echo [1/3] Setting up Python 3.13...

if not exist ".venv\Scripts\python.exe" (
    uv venv --python 3.13 .venv
    if errorlevel 1 goto error
)

echo [2/3] Installing dependencies...

uv pip install --python ".venv\Scripts\python.exe" -r requirements.txt
if errorlevel 1 goto error

echo [3/3] Starting CellScope...

".venv\Scripts\python.exe" app.py
if errorlevel 1 goto error

echo CellScope stopped.
pause
exit /b 0

:error
echo.
echo [ERROR] Setup or startup failed.
echo Please check the messages above.
pause
exit /b 1
