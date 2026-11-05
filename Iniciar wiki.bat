@echo off
chcp 65001 >nul
title Wiki CEJEL IPS
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Necesitas instalar Node.js 18 o superior: https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo.
echo  ==============================================
echo    WIKI CEJEL IPS - Calidad en Salud
echo  ==============================================
echo.
echo  Usuarios de prueba (definidos en el archivo .env):
echo     admin    / Cejel2026!     puede editar y eliminar
echo     editor   / Editor2026!    puede editar
echo     docente  / Docente2026!   puede editar
echo.
echo  Abriendo http://localhost:3000 en tu navegador...
echo  Para apagar la wiki cierra esta ventana.
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
if not exist node_modules call npm install --omit=dev
node --no-warnings server\server.js
echo.
pause
