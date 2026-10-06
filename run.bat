@echo off
title Cartharsis
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Python nahi mila. Pehle Python install karo: https://python.org
  echo   Install karte waqt "Add Python to PATH" tick karna.
  echo.
  pause
  exit /b
)

echo.
echo   Cartharsis - dependencies check kar raha hoon (pehli baar thoda time lagega)...
python -m pip install -r requirements.txt --quiet --disable-pip-version-check

echo.
echo   Cartharsis start ho raha hai...
echo   Browser apne aap khul jayega: http://localhost:5000
echo   (Band karne ke liye is window me Ctrl+C dabao)
echo.

start "" cmd /c "timeout /t 4 >nul && start http://localhost:5000"
python app.py

pause
