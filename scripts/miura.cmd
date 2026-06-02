@echo off
REM MiuraSwarm launcher for Windows cmd — works from ANY directory
REM Setup: copy this file to a directory in your PATH (e.g., C:\Users\carja\bin\miura.cmd)
REM The script changes to miuraswarm/ and runs bun from there

cd /d "C:\Users\carja\miuraswarm"
"C:\Users\carja\AppData\Roaming\npm\bun.cmd" run src/cli/index.ts %*