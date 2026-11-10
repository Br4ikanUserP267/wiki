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

if not exist ".env" (
  echo  Falta el archivo .env.
  echo  Copia .env.example como .env y configura MYSQL_URL.
  echo.
  pause
  exit /b 1
)

findstr /b /c:"MYSQL_URL=" /c:"DATABASE_URL=" ".env" >nul
if errorlevel 1 (
  echo  Falta MYSQL_URL en .env.
  echo  Configura la conexion a MySQL o MariaDB antes de iniciar.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\mysql2" (
  echo  Instalando dependencias...
  call npm.cmd install --omit=dev
  if errorlevel 1 (
    echo.
    echo  No fue posible instalar las dependencias.
    pause
    exit /b 1
  )
)

echo  Abriendo http://localhost:3000 en tu navegador...
echo  Para apagar la wiki cierra esta ventana.
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
node --no-warnings server\server.js
echo.
pause
