@echo off
setlocal
cd /d "%~dp0"

echo === Parker ^& Jolan wedding site - local dev ===
echo.

REM The local Supabase database runs in Docker, so Docker must be up first.
docker info >nul 2>&1
if errorlevel 1 (
    echo Docker isn't running. Start Docker Desktop, wait for it to finish
    echo loading, then run this script again.
    pause
    exit /b 1
)

REM Starts the local Supabase stack (Postgres, REST API, Auth, Studio).
REM On first run this creates the database, applies supabase/migrations/,
REM and loads supabase/seed.sql. If it's already running this is a no-op.
echo Starting local Supabase database...
call npx supabase start
if errorlevel 1 (
    echo Supabase failed to start. See the output above.
    pause
    exit /b 1
)

REM Serve the site itself in a separate window so this one can finish.
REM -c-1 disables caching so edits show up on refresh.
echo Starting web server...
start "wedding-site (close to stop)" cmd /k npx -y http-server . -p 8000 -c-1

REM Open the site in the default browser.
start "" http://localhost:8000

echo.
echo   Site:            http://localhost:8000
echo   Admin dashboard: http://localhost:8000/admin.html
echo   Supabase Studio: http://127.0.0.1:54323
echo.
echo To stop: close the "wedding-site" window, then run "npx supabase stop"
echo if you also want to shut down the database.
pause
