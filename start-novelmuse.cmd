@echo off
REM NovelMuse 一键启动（剥离态：AI 自动写作模块已移出，手写台在位）
REM 用法：双击本文件，或在终端运行 start-novelmuse.cmd
setlocal
cd /d F:\new1.2

echo === NovelMuse 启动 ===
echo 工作区: F:\new1.2
echo.

REM 1) 清掉残留的 dev 进程与端口
echo [1/3] 清理旧进程...
for /f "tokens=2 delims=," %%p in ('tasklist /fi "imagename eq node.exe" /fo csv /nh 2^>nul ^| findstr /i "node.exe"') do (
  wmic process where "ProcessId=%%~p" get CommandLine 2>nul | findstr /i "tsx watch vite" >nul && taskkill /f /pid %%~p >nul 2>&1
)
timeout /t 2 /nobreak >nul

REM 2) 启动后端
echo [2/3] 启动后端 (:3774)...
start "NovelMuse-Server" cmd /k "cd /d F:\new1.2 && pnpm --filter @novel/server dev"

REM 3) 启动前端
echo [3/3] 启动前端 (:5174)...
start "NovelMuse-Web" cmd /k "cd /d F:\new1.2 && pnpm --filter @novel/web dev"

echo.
echo 已启动两个窗口（NovelMuse-Server / NovelMuse-Web）。
echo   前端: http://localhost:5174
echo   后端: http://localhost:3774/api/health
echo   登录: admin / Admin1234!
echo.
timeout /t 5 /nobreak >nul
start http://localhost:5174/
endlocal
