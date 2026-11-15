@echo off
chcp 65001 >nul
title AvtoSpilnota

set "SITE=C:\Users\D\Desktop\сайт автомобільний"
set "BACKEND=C:\Users\D\Desktop\сайт автомобільний\backend"

echo ========================================
echo   AvtoSpilnota - start
echo ========================================
echo.

if not exist "%BACKEND%\venv\Scripts\python.exe" (
    echo [ERROR] venv not found. First run:
    echo   py -3.12 -m venv venv
    echo   venv\Scripts\activate
    echo   python -m pip install -r requirements.txt
    pause
    exit /b 1
)

rem Лапки навколо set потрібні: без них пробіл перед && потрапляє в значення ("dev " замість "dev")
set "AUTOSPILNOTA_ENV=dev"

echo [1/2] Starting API  http://127.0.0.1:8000
start "AvtoSpilnota API" /d "%BACKEND%" cmd /k venv\Scripts\python.exe -m uvicorn app.main:app

timeout /t 3 /nobreak >nul

echo [2/2] Starting site http://127.0.0.1:5500
start "AvtoSpilnota Site" /d "%SITE%" cmd /k py -3.12 serve.py 5500

timeout /t 2 /nobreak >nul
start http://127.0.0.1:5500/

echo.
echo API:  http://127.0.0.1:8000/docs
echo Site: http://127.0.0.1:5500/
echo.
echo Do not close the two black windows.
pause
