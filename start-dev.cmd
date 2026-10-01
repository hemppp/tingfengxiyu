@echo off
chcp 65001 >nul
title NovelMuse 启动器
cd /d %~dp0

echo ============================================
echo   NovelMuse 启动器
echo ============================================
echo.
echo 后端: http://localhost:3774
echo 前端: http://localhost:5180
echo.
echo 注意: 依赖必须用 Node 24（better-sqlite3 是 ABI 137 原生模块）
echo.

REM ---------- 后端 (cordis 宿主) ----------
echo [1/2] 启动后端 ...
start "NovelMuse-Server" cmd /k "cd /d %~dp0apps\server && D:\ruanjian\node.24\node.exe ..\..\node_modules\tsx\dist\cli.mjs src\index.ts"

REM 等后端把 3774 听起来再起前端（前端 /api 代理指向 3774）
timeout /t 6 /nobreak >nul

REM ---------- 前端 (vite) ----------
REM --host 127.0.0.1 是为了同时监听 IPv4，避免浏览器解析 localhost 到 ::1 时连不上
echo [2/2] 启动前端 ...
start "NovelMuse-Web" cmd /k "cd /d %~dp0apps\web && D:\ruanjian\node.24\node.exe ..\..\node_modules\vite\bin\vite.js --port 5180 --strictPort --host 127.0.0.1"

timeout /t 8 /nobreak >nul

echo.
echo 已启动。浏览器将打开 http://localhost:5180
echo 关闭那两个黑窗口即可停止服务。
echo.
start "" http://localhost:5180

exit /b 0
