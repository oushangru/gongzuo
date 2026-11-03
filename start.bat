@echo off
chcp 65001 >nul
title 求职进度管理系统
cd /d "%~dp0"

echo ============================================
echo   求职进度管理系统 - 一键启动
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先到 https://nodejs.org/ 下载安装 v22 或更高版本。
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [首次运行] 正在安装依赖，请稍候...
    echo.
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo [错误] 依赖安装失败，请检查网络后重新双击本文件。
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [完成] 依赖安装成功。
    echo.
)

echo [启动] 服务启动后会自动打开浏览器，请稍候...
echo [提示] 关闭本窗口或按 Ctrl+C 即可停止服务。
echo.
node --disable-warning=ExperimentalWarning server.js

pause
