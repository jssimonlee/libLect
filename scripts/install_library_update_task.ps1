$ErrorActionPreference = "Stop"

$taskName = "libLect library-site refresh"
$runnerPath = (Resolve-Path (Join-Path $PSScriptRoot "run_incremental_library_update.ps1")).Path
$powerShellPath = Join-Path $PSHOME "powershell.exe"
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerPath`""

$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At "03:30"
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal `
    -UserId $userId `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Refresh one oldest Hwaseong library site, test the search index, and push verified data." `
    -Force | Out-Null

Write-Output "Installed scheduled task: $taskName"
Write-Output "Schedule: daily at 03:30; missed runs start after the next sign-in."
