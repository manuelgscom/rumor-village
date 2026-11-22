# Smoke test of a Windows prebuilt package, Sin IA (phase 10, docs/fases/fase-10.md).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File dist\windows\smoke.ps1 <folder> [-Launcher] [-Port N]
#
# <folder> is the unpacked package (rumor-village.exe) or a build stage
# (rumor.exe). Starts the game, asks GET /state, checks the version and quits
# with POST /quit. Prints PASS or FAIL and exits 0 or 1.
#
#   rumor[-village].exe play --port N --data .. --viewer .. --out <tmp>
#         |  GET  http://127.0.0.1:N/state  -> "version" == dist\VERSION
#         |  POST http://127.0.0.1:N/quit   -> the process ends with 0
#
# Without -Launcher: `play`, with data\ and viewer\ from the folder when it has
# them, else from this repo. With -Launcher: `--no-browser --data-dir <tmp>`;
# the address comes from the console, which must also show the notice of the
# hardware check (-Expect, a regex). By default, on a computer without a GPU:
# "no NVIDIA" for a CUDA package; "no Vulkan" or "no graphics card" otherwise.
#
# PowerShell 5.1 reads scripts without a BOM as ANSI: keep this file ASCII.

param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Folder,
    [switch]$Launcher,
    [int]$Port = 18080,
    [string]$Expect = '',
    [string]$Version = '',
    [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Folder = (Resolve-Path $Folder).Path

function Finish([bool]$ok, [string]$why) {
    if ($script:proc -and -not $script:proc.HasExited) { Stop-Process -Id $script:proc.Id -Force -ErrorAction SilentlyContinue }
    if (-not $ok) {
        foreach ($log in @($script:stdout, $script:stderr)) {
            if ($log -and (Test-Path $log)) { Get-Content $log -Encoding UTF8 -Tail 20 | ForEach-Object { Write-Host "  | $_" } }
        }
    }
    if ($script:tmp -and (Test-Path $script:tmp)) { Remove-Item -Recurse -Force $script:tmp -ErrorAction SilentlyContinue }
    Write-Host ("smoke: {0} ({1})" -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $why)
    if ($ok) { exit 0 } else { exit 1 }
}

$exe = Join-Path $Folder 'rumor-village.exe'
if (-not (Test-Path $exe)) { $exe = Join-Path $Folder 'rumor.exe' }
if (-not (Test-Path $exe)) { Write-Host 'smoke: FAIL (no rumor-village.exe or rumor.exe)'; exit 1 }
if (-not $Version) {
    $file = @((Join-Path $Folder 'VERSION'), (Join-Path $repo 'dist\VERSION')) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $file) { Write-Host 'smoke: FAIL (no VERSION to compare with: give -Version)'; exit 1 }
    $Version = (Get-Content $file -TotalCount 1).Trim()
}
$cuda = Test-Path (Join-Path $Folder 'cudart64_12.dll')
if (-not $Expect) {
    $Expect = $(if ($cuda) { 'tarjetas NVIDIA y tu equipo no tiene una|NVIDIA cards and your computer has none' }
                else { 'No se encuentra Vulkan|Vulkan was not found|No hay una tarjeta|There is no graphics card' })
}

$script:tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("rumor-smoke-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $script:tmp | Out-Null
$script:stdout = Join-Path $script:tmp 'stdout.txt'
$script:stderr = Join-Path $script:tmp 'stderr.txt'

function Pick([string]$name) {
    $inFolder = Join-Path $Folder $name
    if (Test-Path $inFolder) { return $inFolder }
    return (Join-Path $repo $name)
}

if ($Launcher) {
    $arguments = @('--no-browser', '--data-dir', "`"$(Join-Path $script:tmp 'data-dir')`"")
} else {
    $arguments = @('play', '--port', "$Port", '--data', "`"$(Pick 'data')`"", '--viewer', "`"$(Pick 'viewer')`"",
        '--out', "`"$(Join-Path $script:tmp 'out')`"")
}
Write-Host "smoke: $exe $($arguments -join ' ')"
$script:proc = Start-Process -FilePath $exe -ArgumentList $arguments -NoNewWindow -PassThru `
    -RedirectStandardOutput $script:stdout -RedirectStandardError $script:stderr
# PowerShell 5.1 loses ExitCode unless the handle is taken while it runs.
$null = $script:proc.Handle

# Wait for /state (the launcher: first for its address on the console).
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$base = $(if ($Launcher) { '' } else { "http://127.0.0.1:$Port" })
$state = $null
while ((Get-Date) -lt $deadline -and -not $state) {
    if ($script:proc.HasExited) { Finish $false "the game ended with $($script:proc.ExitCode) before answering" }
    if (-not $base) {
        $console = (Get-Content $script:stdout, $script:stderr -Encoding UTF8 -ErrorAction SilentlyContinue) -join "`n"
        if ($console -match 'http://(127\.0\.0\.1|localhost):(\d+)') { $base = "http://127.0.0.1:$($Matches[2])" }
    }
    if ($base) {
        try {
            $state = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri "$base/state").Content | ConvertFrom-Json
        } catch { $state = $null }
    }
    if (-not $state) { Start-Sleep -Milliseconds 500 }
}
if (-not $state) { Finish $false "no answer from /state in $TimeoutSeconds s" }
if ($state.version -ne $Version) { Finish $false "version '$($state.version)', expected '$Version'" }

if ($Launcher) {
    $lines = Get-Content $script:stdout, $script:stderr -Encoding UTF8 -ErrorAction SilentlyContinue
    $lines | ForEach-Object { Write-Host "  | $_" }
    if ((($lines) -join "`n") -notmatch $Expect) { Finish $false "the console does not show the notice /$Expect/" }
}

try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Method Post -Uri "$base/quit" | Out-Null
} catch { Finish $false "POST /quit failed: $($_.Exception.Message)" }
if (-not $script:proc.WaitForExit(15000)) { Finish $false 'still running 15 s after POST /quit' }
$script:proc.WaitForExit()
if ($script:proc.ExitCode -ne 0) { Finish $false "exit code $($script:proc.ExitCode) after POST /quit" }
Finish $true "version $Version, $base"
