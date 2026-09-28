@echo off
chcp 65001 >nul
title Trae 积分悬浮窗启动器
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

if exist "node_modules\electron\package.json" goto run

echo 首次运行，正在安装依赖，大约需要 1-2 分钟，请勿关闭本窗口...
call npm install --no-fund --no-audit
if errorlevel 1 goto fail
goto run

:run
echo 正在启动悬浮窗...
start "" /min npm start
echo 启动完成，本窗口将自动关闭。
ping -n 3 127.0.0.1 >nul
exit /b 0

:fail
echo.
echo [错误] 依赖安装失败，请检查网络后重新运行本脚本。
pause
exit /b 1

:nonode
echo [错误] 未检测到 Node.js，请先从 https://nodejs.org 安装后重试。
pause
exit /b 1
