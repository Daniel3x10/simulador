@echo off
title PUENTE PUBLICO - SIMULADOR TESIS MINAS
cls
echo =============================================================
echo   INICIANDO PUENTE PUBLICO (SIN DEPLOY)
echo =============================================================
echo Conectando servidor y generando enlace HTTPS publico...
echo.
node "%~dp0puente.js"
pause
