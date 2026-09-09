@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 화성시립도서관 전체 정보 업데이트

echo 화성시립도서관 사이트를 한 곳씩 순서대로 업데이트합니다.
echo 완료될 때까지 이 창을 닫지 마세요.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run_full_library_update.ps1"
set "UPDATE_EXIT=%ERRORLEVEL%"

echo.
if "%UPDATE_EXIT%"=="0" (
    echo 업데이트가 정상적으로 완료되었습니다.
) else (
    echo 업데이트가 안전하게 중단되었습니다.
    echo 자세한 내용은 .library-update.log 파일을 확인하세요.
)
echo.
pause
exit /b %UPDATE_EXIT%
