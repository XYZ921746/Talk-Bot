@echo off
chcp 65001 >nul
setlocal
title AI 语音通话
cd /d "%~dp0"

echo.
echo  ==============================================
echo     AI 语音通话 - 一键启动
echo  ==============================================
echo.

REM --- 检查 Node.js ---
where node >nul 2>nul
if errorlevel 1 (
    echo  [错误] 没有检测到 Node.js！
    echo  请先安装 Node.js（下载地址 https://nodejs.org/ ，选 LTS 版），
    echo  安装完成后重新双击本文件。
    echo.
    pause
    exit /b 1
)
echo  [OK] Node.js 版本:
node -v
echo.

REM --- 放行防火墙（手机/局域网访问 3210 端口需要；需管理员权限） ---
netsh advfirewall firewall delete rule name="AI语音通话" >nul 2>nul
netsh advfirewall firewall add rule name="AI语音通话" dir=in action=allow protocol=TCP localport=3210 >nul 2>nul
if errorlevel 1 (
    echo  [提示] 未获得管理员权限，未能自动放行防火墙。
    echo  如果手机无法访问，请右键本文件 →"以管理员身份运行"，
    echo  或在 Windows 安全中心手动放行 TCP 端口 3210。
    echo.
)

REM --- 首次运行：安装依赖 ---
if not exist "node_modules" (
    echo  [首次运行] 正在安装依赖，可能需要几分钟...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo  [错误] 依赖安装失败，请检查网络后重试。
        pause
        exit /b 1
    )
)

REM --- 首次运行：构建前端 ---
if not exist "web\dist\index.html" (
    echo  [首次运行] 正在构建前端页面...
    call npm run build -w web
    if errorlevel 1 (
        echo  [错误] 前端构建失败。
        pause
        exit /b 1
    )
)

REM --- 首次运行：构建服务端 ---
if not exist "server\dist\index.js" (
    echo  [首次运行] 正在构建服务端...
    call npm run build -w server
    if errorlevel 1 (
        echo  [错误] 服务端构建失败。
        pause
        exit /b 1
    )
)

REM --- 获取局域网 IP（手机访问用） ---
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr "IPv4"') do set "LANIP=%%a"
set "LANIP=%LANIP: =%"

echo.
echo  服务即将启动...
echo  ----------------------------------------------
echo   本机访问:   http://localhost:3210
if defined LANIP echo   手机访问:   http://%LANIP%:3210
echo  ----------------------------------------------
echo   提示: 手机和电脑需连同一个 Wi-Fi；
echo        关闭本窗口即停止服务。
echo   语音识别/合成: 首次使用请在网页「设置」里配置
echo        （腾讯云/百度/讯飞 ASR，或 Edge TTS 免费合成）。
echo.

REM --- 2 秒后自动打开浏览器，然后前台启动服务 ---
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3210"
node server/dist/index.js

echo.
echo  服务已停止。
pause