# MiuraSwarm launcher for PowerShell
# Add to $PROFILE: C:\Users\carja\miuraswarm\scripts\miura.ps1
# Or in PowerShell: . C:\Users\carja\miuraswarm\scripts\miura.ps1

function miura {
    Set-Location C:\Users\carja\miuraswarm
    bun start $args
    Set-Location $OLDPWD
}