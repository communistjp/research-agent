param(
  [string]$TaskPrefix = "ResearchAgentNews"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$ConfigPath = Join-Path $Root "config\schedule.json"
$LogDir = Join-Path $Root "outputs\logs"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (Test-Path $ConfigPath) {
  $Config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
  $Times = @($Config.times)
} else {
  $Times = @("07:00", "12:30", "19:00")
}

if (-not $Times -or $Times.Count -eq 0) {
  throw "No schedule times configured."
}

$Node = (Get-Command node -ErrorAction Stop).Source
$RefreshLog = Join-Path $LogDir "news-refresh.log"
$ServerLog = Join-Path $LogDir "news-server.log"

function Register-DailyRefreshTask {
  param([string]$Time)
  $TaskName = "$TaskPrefix-Refresh-$($Time.Replace(':', ''))"
  $Command = "cd /d `"$Root`" && cmd /c npm run news:refresh >> `"$RefreshLog`" 2>&1"
  $TaskRun = "cmd.exe /c `"$Command`""
  schtasks.exe /Create /TN $TaskName /SC DAILY /ST $Time /TR $TaskRun /F | Out-Host
}

function Register-ServerTask {
  $TaskName = "$TaskPrefix-Server"
  $Command = "cd /d `"$Root`" && `"$Node`" dist/server.js >> `"$ServerLog`" 2>&1"
  $TaskRun = "cmd.exe /c `"$Command`""
  schtasks.exe /Create /TN $TaskName /SC ONLOGON /TR $TaskRun /F | Out-Host
}

foreach ($Time in $Times) {
  Register-DailyRefreshTask -Time $Time
}
Register-ServerTask

Write-Host "Registered $TaskPrefix tasks:"
schtasks.exe /Query /TN "$TaskPrefix-Server" /FO LIST | Out-Host
foreach ($Time in $Times) {
  schtasks.exe /Query /TN "$TaskPrefix-Refresh-$($Time.Replace(':', ''))" /FO LIST | Out-Host
}
