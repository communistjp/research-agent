param(
  [string]$TaskPrefix = "ResearchAgentNews"
)

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$ConfigPath = Join-Path $Root "config\schedule.json"

if (Test-Path $ConfigPath) {
  $Config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
  $Times = @($Config.times)
} else {
  $Times = @("07:00", "12:30", "19:00")
}

schtasks.exe /Delete /TN "$TaskPrefix-Server" /F | Out-Host
foreach ($Time in $Times) {
  schtasks.exe /Delete /TN "$TaskPrefix-Refresh-$($Time.Replace(':', ''))" /F | Out-Host
}
