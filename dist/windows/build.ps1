# Builds the Windows binary of a prebuilt package (phase 10, docs/fases/fase-10.md).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File dist\windows\build.ps1 -Backend cuda|vulkan [-Tests]
#
# Run on the Windows machine, from a copy of the repo (scripts/dist-win.sh makes
# it and calls this). Configures with MSVC and Ninja from the vcvars64
# environment in <BuildRoot>\<backend>, builds rumor.exe (and rumor_tests.exe
# with -Tests) and leaves <BuildRoot>\<backend>\stage with rumor.exe and the
# DLLs it needs. Then checks with dumpbin /dependents that the binary asks for
# nothing outside the stage and Windows: never nvcuda.dll, and vulkan-1.dll and
# cublas64_12.dll only delay-loaded.
#
#   build.ps1 --> vcvars64 env --> cmake -G Ninja --> rumor.exe --> stage\ --> dumpbin
#                                   (CUDA from -CudaRoot, read only)   + cudart64_12.dll
#                                                                      + cublas64_12.dll
#                                                                      + cublasLt64_12.dll
#
# PowerShell 5.1 reads scripts without a BOM as ANSI: keep this file ASCII.

param(
    [Parameter(Mandatory = $true)][ValidateSet('cuda', 'vulkan')][string]$Backend,
    [switch]$Tests,
    [string]$Source = '',
    [string]$BuildRoot = 'C:\rv\build',
    [string]$CudaRoot = 'C:\ils\tools\cuda-12.9.1',
    [string]$VulkanSdk = '',
    [string]$CudaArchitectures = '61-real;75-real;86-real;89-real;120a-real;89-virtual',
    [int]$Jobs = 0,
    [string]$EngineCommit = 'unknown',
    [string]$LlamaCommit = 'unknown'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$started = Get-Date
# $PSScriptRoot is empty in param() defaults on PowerShell 5.1.
if (-not $Source) { $Source = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }

function Fail([string]$message) {
    Write-Host "build.ps1: $message" -ForegroundColor Red
    exit 1
}

# Runs a native command and stops on a non-zero exit code.
function Invoke-Native([string]$exe, [string[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { Fail "$exe failed ($LASTEXITCODE)" }
}

# --- The MSVC environment (vcvars64), imported into this process -------------
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vsPath = $null
if (Test-Path $vswhere) {
    $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
}
if (-not $vsPath) { $vsPath = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools' }
$vcvars = Join-Path $vsPath 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) { Fail "vcvars64.bat not found in $vsPath" }
cmd /c "`"$vcvars`" >nul && set" | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2] }
}
if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) { Fail 'cl.exe not in PATH after vcvars64' }
if (-not (Get-Command ninja.exe -ErrorAction SilentlyContinue)) { Fail 'ninja.exe not in PATH (winget install Ninja-build.Ninja)' }

# --- Backend ----------------------------------------------------------------
$buildDir = Join-Path $BuildRoot $Backend
$stage = Join-Path $buildDir 'stage'
$options = @(
    '-S', (Join-Path $Source 'engine'), '-B', $buildDir, '-G', 'Ninja',
    '-DCMAKE_BUILD_TYPE=Release',
    '-DRUMOR_LLAMA=ON', '-DRUMOR_DIST=ON',
    '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded',
    # A binary for other computers, as dist/linux/build.sh: the CPU part of
    # ggml (little: the model runs on the GPU) up to SSE4.2 only, not the CPU
    # of this machine.
    '-DGGML_NATIVE=OFF', '-DGGML_SSE42=ON', '-DGGML_AVX=OFF', '-DGGML_AVX2=OFF', '-DGGML_BMI2=OFF',
    '-DGGML_FMA=OFF', '-DGGML_F16C=OFF', '-DGGML_AVX512=OFF',
    "-DRUMOR_ENGINE_COMMIT=$EngineCommit", "-DRUMOR_LLAMA_COMMIT=$LlamaCommit"
)
$dlls = @()
if ($Backend -eq 'cuda') {
    $nvcc = Join-Path $CudaRoot 'bin\nvcc.exe'
    if (-not (Test-Path $nvcc)) { Fail "nvcc not found: $nvcc" }
    $env:CUDA_PATH = $CudaRoot
    $env:PATH = "$CudaRoot\bin;$env:PATH"
    $options += @(
        '-DRUMOR_CUDA=ON', '-DRUMOR_VULKAN=OFF',
        "-DCMAKE_CUDA_COMPILER=$($nvcc -replace '\\', '/')",
        "-DCUDAToolkit_ROOT=$($CudaRoot -replace '\\', '/')",
        "-DCMAKE_CUDA_ARCHITECTURES=$CudaArchitectures",
        # NCCL is for several GPUs and is not shipped.
        '-DGGML_CUDA_NCCL=OFF'
    )
    $dlls = @('cudart64_12.dll', 'cublas64_12.dll', 'cublasLt64_12.dll') | ForEach-Object { Join-Path $CudaRoot "bin\$_" }
} else {
    if (-not $VulkanSdk) {
        $VulkanSdk = Get-ChildItem 'C:\VulkanSDK' -Directory -ErrorAction SilentlyContinue |
            Sort-Object { [version]$_.Name } | Select-Object -Last 1 -ExpandProperty FullName
    }
    if (-not $VulkanSdk -or -not (Test-Path (Join-Path $VulkanSdk 'Bin\glslc.exe'))) { Fail "Vulkan SDK not found ($VulkanSdk)" }
    $env:VULKAN_SDK = $VulkanSdk
    $env:PATH = "$VulkanSdk\Bin;$env:PATH"
    $options += @('-DRUMOR_CUDA=OFF', '-DRUMOR_VULKAN=ON')
}

# One job per core, at most one per GB of memory (nvcc with six architectures
# stays under 1 GB per file, measured on the virtual machine).
if ($Jobs -le 0) {
    $ramGb = [math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
    $Jobs = [math]::Max(1, [math]::Min([int]$env:NUMBER_OF_PROCESSORS, $ramGb))
}

Write-Host "build.ps1: $Backend in $buildDir ($Jobs jobs)"
Invoke-Native 'cmake' $options
$targets = @('rumor')
if ($Tests) { $targets += 'rumor_tests' }
Invoke-Native 'cmake' (@('--build', $buildDir, '-j', "$Jobs", '--target') + $targets)
$built = Get-Date

# --- Stage --------------------------------------------------------------------
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item (Join-Path $buildDir 'rumor.exe') $stage
foreach ($dll in $dlls) {
    if (-not (Test-Path $dll)) { Fail "missing $dll" }
    Copy-Item $dll $stage
}

# --- dumpbin /dependents --------------------------------------------------------
# Every DLL must be in the stage or be part of Windows. "Part of Windows" is a
# DLL in System32 that is not one of the redistributable or driver libraries a
# clean Windows does not have.
$notWindows = '^(vcruntime|msvcp|vcomp|concrt|vccorlib|ucrtbased|api-ms-win-crt-|nvcuda|nvml|nccl|cudart|cublas|vulkan-1)'
$exe = Join-Path $stage 'rumor.exe'
$section = ''
$direct = @(); $delayed = @()
foreach ($line in (& dumpbin /nologo /dependents $exe)) {
    if ($line -match 'has the following dependencies') { $section = 'direct'; continue }
    if ($line -match 'has the following delay load dependencies') { $section = 'delay'; continue }
    if ($line -match '^\s*Summary') { break }
    if ($line -match '^\s+(\S+\.dll)\s*$') {
        if ($section -eq 'direct') { $direct += $Matches[1] } elseif ($section -eq 'delay') { $delayed += $Matches[1] }
    }
}
$bad = @()
foreach ($dll in $direct) {
    $inStage = Test-Path (Join-Path $stage $dll)
    $inWindows = (Test-Path (Join-Path $env:SystemRoot "System32\$dll")) -and ($dll -notmatch $notWindows)
    if (-not ($inStage -or $inWindows)) { $bad += $dll }
}
foreach ($dll in $delayed) {
    if ($dll -ne 'vulkan-1.dll' -and -not (Test-Path (Join-Path $stage $dll)) -and
        -not ((Test-Path (Join-Path $env:SystemRoot "System32\$dll")) -and ($dll -notmatch $notWindows))) { $bad += $dll }
}
Write-Host "dependents: $($direct -join ' ')"
Write-Host "delay-load: $(if ($delayed) { $delayed -join ' ' } else { '-' })"
if ($bad) { Fail "rumor.exe needs what is neither in the stage nor in Windows: $($bad -join ' ')" }
if ($Backend -eq 'vulkan' -and ($direct -contains 'vulkan-1.dll' -or $delayed -notcontains 'vulkan-1.dll')) {
    Fail 'vulkan-1.dll must be delay-loaded only'
}
# cublas64_12.dll (and the cublasLt64_12.dll it pulls in, about 770 MB) only
# when the model runs: loaded before main, it kept the console empty for seconds.
if ($Backend -eq 'cuda' -and ($direct -contains 'cublas64_12.dll' -or $delayed -notcontains 'cublas64_12.dll')) {
    Fail 'cublas64_12.dll must be delay-loaded only'
}

# The embedded manifest: the process code page is UTF-8 (dist\windows\rumor.manifest).
$manifest = Join-Path $buildDir 'rumor.embedded.manifest'
& mt.exe -nologo "-inputresource:$exe;#1" "-out:$manifest" | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Select-String -Path $manifest -Pattern '<activeCodePage[^>]*>UTF-8<' -Quiet)) {
    Fail 'rumor.exe has no manifest with activeCodePage UTF-8'
}
Write-Host 'manifest: activeCodePage UTF-8'

# Timed: what the Windows loader takes before main (the DLLs it maps).
$watch = [Diagnostics.Stopwatch]::StartNew()
& $exe --version
if ($LASTEXITCODE -ne 0) { Fail 'rumor.exe --version failed' }
Write-Host ("--version: {0:N2} s" -f $watch.Elapsed.TotalSeconds)

$size = (Get-ChildItem $stage | Measure-Object -Property Length -Sum).Sum
Get-ChildItem $stage | ForEach-Object { Write-Host ("  {0,-22} {1,8:N1} MB" -f $_.Name, ($_.Length / 1MB)) }
Write-Host ("build.ps1: stage {0:N1} MB, build {1:N1} min, total {2:N1} min" -f ($size / 1MB),
    ($built - $started).TotalMinutes, ((Get-Date) - $started).TotalMinutes)
exit 0
