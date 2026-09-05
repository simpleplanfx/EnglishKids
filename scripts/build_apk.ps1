#Requires -Version 5.1
<#
.SYNOPSIS
    英语小超人 — 一键本地编译 APK

.DESCRIPTION
    从零开始在本机自动搭建 Android 构建环境并编译出 app-debug.apk。
    全程无需手工安装 JDK / Android Studio，双击 scripts\run_build.bat 即可。

    脚本是「幂等」的：任何一步中断后重新运行，已完成的部分会自动跳过，
    不会重复下载（已检测的组件：JDK、command-line tools、SDK 平台/构建工具）。

.PARAMETER 无
    所有配置集中在下方「配置区」，一般无需改动。

.EXAMPLE
    # 推荐方式：双击 run_build.bat
    # 或命令行：
    powershell -ExecutionPolicy Bypass -File .\scripts\build_apk.ps1

.NOTES
    作者   : 英语小超人项目
    适用   : Windows 10 / 11 (PowerShell 5.1+)
    总下载 : 首次约 1GB（JDK ~190MB + Android SDK ~150MB + 平台/构建工具 ~500MB + Gradle 依赖）

    目录布局（重要）：
        D:\software\EnglishKidsAPK\          <- $ToolRoot   工具链（仓库外，不入 git）
            jdk17\                           <- JDK 17
            android-sdk\                     <- Android SDK
            EnglishKidsApp\                  <- $RepoRoot   仓库根 = Android 工程根
                scripts\build_apk.ps1        <- 本脚本
                app\src\main\assets\         <- 网页与词库
                app-debug.apk                <- 编译产物

    维护提示：
      - 升级 AGP/Gradle 版本请改 app\build.gradle 与 gradle\wrapper\gradle-wrapper.properties
      - 更换词库请改 app\src\main\assets\data\words.json（结构见 docs\05-维护与升级指南.md）
      - 若工具链想放别处，设置环境变量 EKIDS_TOOL_ROOT 即可覆盖
#>

$ErrorActionPreference = 'Stop'

# ============================================================
#  配置区：路径推导
# ============================================================
# 本脚本位于 <仓库根>\scripts\ 下，因此：
#   $ScriptDir = <仓库根>\scripts
#   $RepoRoot  = <仓库根>          （同时也是标准 Android 工程根，gradlew 在此）
#   $ToolRoot  = <仓库根> 的上一级（JDK / Android SDK 存放处，位于仓库外）
#
# 把工具链放在仓库外是刻意为之：它们有数 GB，且与机器强相关，
# 绝不能进入 git 仓库（已由 .gitignore 双重保险）。
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir

# 允许用环境变量 EKIDS_TOOL_ROOT 覆盖工具链位置，便于在其它机器上复用本脚本
if ($env:EKIDS_TOOL_ROOT) {
    $ToolRoot = $env:EKIDS_TOOL_ROOT
} else {
    $ToolRoot = Split-Path -Parent $RepoRoot
}

$ProjectDir = $RepoRoot                                  # Android 工程根（gradlew 所在）
$JdkDir     = Join-Path $ToolRoot 'jdk17'                # JDK 17 安装位置
$SdkDir     = Join-Path $ToolRoot 'android-sdk'          # Android SDK 安装位置
$ApkOut     = Join-Path $RepoRoot 'app-debug.apk'        # 最终产出的安装包

# 下载用的公共参数：模拟浏览器 UA，避免部分 CDN 拒绝脚本式请求
$Headers = @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0' }

function Step($m) { Write-Host "`n==== $m ====`n" -ForegroundColor Cyan }
function Ok($m)   { Write-Host $m -ForegroundColor Green }

Write-Host '工具链目录: ' -NoNewline; Write-Host $ToolRoot -ForegroundColor Gray
Write-Host '工程目录  : ' -NoNewline; Write-Host $ProjectDir -ForegroundColor Gray

# ============================================================
#  步骤 1/5 — 准备 JDK 17
# ============================================================
# Android Gradle Plugin 8.x 要求 JDK 17。这里用「多源 + 重试」策略下载：
# 国内/公司网络常出现「基础连接已经关闭」，单一源极易失败，故准备 3 个源依次尝试。
Step '步骤 1/5  准备 JDK 17'
if (Test-Path "$JdkDir\bin\java.exe") {
    Ok 'JDK 已存在，跳过下载。'
} else {
    $jdkZip = Join-Path $ToolRoot 'jdk17.zip'
    Write-Host '正在下载 JDK 17（约 190MB），请稍候...'

    # 三个下载源，按可靠性排序：前两个是直连 CDN，第三个是 API 跳转 GitHub（兜底）
    $jdkUrls = @(
        @{ n = 'Microsoft Build of OpenJDK (Azure CDN)'; u = 'https://aka.ms/download-jdk/microsoft-jdk-17.0.14.1-windows-x64.zip' },
        @{ n = 'Azul Zulu (Cloudflare CDN)';             u = 'https://cdn.azul.com/zulu/bin/zulu17.50.19-ca-jdk17.0.11-win_x64.zip' },
        @{ n = 'Adoptium API -> GitHub (回退源)';        u = 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse' }
    )

    $old = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
    $ok = $false
    foreach ($src in $jdkUrls) {
        Write-Host "`n  尝试源: $($src.n)" -ForegroundColor Yellow
        for ($t = 1; $t -le 2; $t++) {                       # 每个源内部再重试 2 次
            try {
                if ($t -gt 1) { Write-Host "    第 $t 次重试..." -ForegroundColor DarkYellow }
                Invoke-WebRequest -Uri $src.u -OutFile $jdkZip -MaximumRedirection 10 `
                    -UseBasicParsing -TimeoutSec 600 -Headers $Headers
                $ok = $true; break
            } catch {
                Write-Host "    失败: $($_.Exception.Message)" -ForegroundColor DarkYellow
                if ($t -lt 2) { Start-Sleep -Seconds 4 }
            }
        }
        if ($ok) { Write-Host '  下载成功。' -ForegroundColor Green; break }
    }
    $ProgressPreference = $old

    if (-not $ok) {
        Write-Host "`n所有下载源都失败，请手动处理：" -ForegroundColor Red
        foreach ($s in $jdkUrls) { Write-Host "  - $($s.u)" -ForegroundColor Gray }
        Write-Host "下载 Windows x64 JDK 17 (zip)，解压后确保存在：" -ForegroundColor Yellow
        Write-Host "  $JdkDir\bin\java.exe" -ForegroundColor Yellow
        Write-Host '然后重新运行 run_build.bat。' -ForegroundColor Yellow
        exit 1
    }

    Write-Host '下载完成，解压中...'
    Expand-Archive -Path $jdkZip -DestinationPath $JdkDir -Force
    # JDK 压缩包通常自带一层版本号目录（如 jdk-17.0.11+9），需上提一级
    $inner = Get-ChildItem $JdkDir -Directory | Select-Object -First 1
    if ($inner -and -not (Test-Path "$JdkDir\bin\java.exe")) {
        Get-ChildItem $inner.FullName | Move-Item -Destination $JdkDir -Force
        Remove-Item $inner.FullName -Recurse -Force
    }
    Remove-Item $jdkZip -Force
}

# 将 JDK 注入当前进程环境，供后续 Gradle 使用
$env:JAVA_HOME = $JdkDir
$env:PATH = "$JdkDir\bin;" + $env:PATH
Ok "JAVA_HOME = $JdkDir"
& "$JdkDir\bin\java.exe" -version 2>&1

# ============================================================
#  步骤 2/5 — 准备 Android SDK (command-line tools)
# ============================================================
# 只需要 command-line tools（sdkmanager），后续平台与构建工具由它按需安装。
# 同样采用双重下载策略：Invoke-WebRequest 失败后改用 curl.exe（对断流更宽容）。
Step '步骤 2/5  准备 Android SDK (command-line tools)'
$ctBin = Join-Path $SdkDir 'cmdline-tools\latest\bin\sdkmanager.bat'
if (Test-Path $ctBin) {
    Ok 'command-line tools 已存在，跳过。'
} else {
    New-Item -ItemType Directory -Force -Path $SdkDir | Out-Null
    $ctZip = Join-Path $ToolRoot 'cmdtools.zip'
    Write-Host '正在下载 Android command-line tools（约 150MB）...'
    $old = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'

    $sdkUrl = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
    $ok = $false
    if (Test-Path $ctZip) { Remove-Item $ctZip -Force }

    # 方案 A：Invoke-WebRequest 重试 3 次
    for ($t = 1; $t -le 3; $t++) {
        try {
            if ($t -gt 1) {
                Write-Host "  第 $t 次重试 Invoke-WebRequest..." -ForegroundColor DarkYellow
                Start-Sleep -Seconds 5
            }
            Write-Host "  [Invoke-WebRequest] 下载中（第 $t/3 次）..." -ForegroundColor Yellow
            Invoke-WebRequest -Uri $sdkUrl -OutFile $ctZip -MaximumRedirection 10 `
                -UseBasicParsing -TimeoutSec 600 -Headers $Headers
            $ok = $true; break
        } catch {
            Write-Host "  失败: $($_.Exception.Message)" -ForegroundColor DarkYellow
        }
    }

    # 方案 B：curl.exe 备用（Windows 10+ 自带，断点/断流容错优于 Invoke-WebRequest）
    if (-not $ok) {
        $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
        if ($curl) {
            for ($t = 1; $t -le 3; $t++) {
                try {
                    if ($t -gt 1) {
                        Write-Host "  第 $t 次重试 curl.exe..." -ForegroundColor DarkYellow
                        Start-Sleep -Seconds 5
                    }
                    Write-Host "  [curl.exe] 下载中（第 $t/3 次）..." -ForegroundColor Yellow
                    & curl.exe -L --retry 3 --retry-delay 5 --connect-timeout 30 --max-time 900 `
                        -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0' `
                        -o $ctZip $sdkUrl 2>$null
                    # 校验：文件必须存在且大于 1MB，防止拿到错误页面还当成成功
                    if ((Test-Path $ctZip) -and ((Get-Item $ctZip).Length -gt 1000000)) {
                        $ok = $true; break
                    } else {
                        Write-Host '  curl 返回文件过小或不存在，重试...' -ForegroundColor DarkYellow
                    }
                } catch {
                    Write-Host "  curl 失败: $($_.Exception.Message)" -ForegroundColor DarkYellow
                }
            }
        } else {
            Write-Host '  本机未找到 curl.exe，跳过备用方案。' -ForegroundColor DarkYellow
        }
    }

    $ProgressPreference = $old
    if (-not $ok) {
        Write-Host "`nSDK 下载失败，请手动下载：" -ForegroundColor Red
        Write-Host "  URL : $sdkUrl" -ForegroundColor Gray
        Write-Host "  保存为: $ctZip" -ForegroundColor Gray
        Write-Host '放好后重新运行 run_build.bat，脚本会自动识别。' -ForegroundColor Yellow
        exit 1
    }

    Ok '下载完成，解压中...'
    # 解压后目录结构须为 <sdk>\cmdline-tools\latest\，否则 sdkmanager 拒绝运行
    $tmp = Join-Path $SdkDir '_tmp'
    Expand-Archive -Path $ctZip -DestinationPath $tmp -Force
    $ctRoot = Join-Path $tmp 'cmdline-tools'
    if (-not (Test-Path $ctRoot)) { $ctRoot = $tmp }
    New-Item -ItemType Directory -Force -Path (Join-Path $SdkDir 'cmdline-tools\latest') | Out-Null
    Move-Item "$ctRoot\*" (Join-Path $SdkDir 'cmdline-tools\latest') -Force
    Remove-Item $tmp -Recurse -Force
    Remove-Item $ctZip -Force
}

$env:ANDROID_HOME     = $SdkDir
$env:ANDROID_SDK_ROOT = $SdkDir
$sdkmanager = $ctBin

# ============================================================
#  步骤 3/5 — 接受许可并安装平台与构建工具
# ============================================================
# 只需要三个组件：platform-34（编译 SDK）、build-tools 34.0.0（aapt2/d8 等）、
# platform-tools（adb，AGP 会自动触发安装）。其余（模拟器、NDK）一概不装以节省体积。
Step '步骤 3/5  接受许可并安装 Android 34 平台与构建工具'
Write-Host '自动接受许可...'
(1..40 | ForEach-Object { 'y' }) | & $sdkmanager --licenses 2>$null
Write-Host '安装 platforms;android-34 与 build-tools;34.0.0（约数百 MB）...'
(1..5 | ForEach-Object { 'y' }) | & $sdkmanager 'platforms;android-34' 'build-tools;34.0.0'
if ($LASTEXITCODE -ne 0) { throw 'SDK 组件安装失败，请查看上方错误。' }
Ok 'SDK 组件安装完成。'

# ============================================================
#  步骤 4/5 — 用 Gradle 编译 app-debug.apk
# ============================================================
Step '步骤 4/5  用 Gradle 编译 app-debug.apk'

# local.properties 记录本机 SDK 路径，由脚本生成（已在 .gitignore 中排除，
# 因为它含绝对路径，换机器会变，不能入库）。
$sdkProp = 'sdk.dir=' + ($SdkDir -replace '\\', '\\')
$sdkProp | Out-File -FilePath "$ProjectDir\local.properties" -Encoding ascii

$gradlew = Join-Path $ProjectDir 'gradlew.bat'
Write-Host '首次编译会下载 Gradle 与依赖（约 100MB+），请耐心等待，不要关闭窗口...'

# ⚠️ 关键坑 1：必须切换到工程目录再执行 gradlew。
#    Gradle 是依据「当前工作目录」寻找 settings.gradle 的，而不是依据
#    gradlew.bat 自身所在位置。若不切换，会报 "Directory ... does not
#    contain a Gradle build"。
Push-Location $ProjectDir
$gradleExit = 0
try {
    & $gradlew assembleDebug --no-daemon --stacktrace

    # ⚠️ 关键坑 2：必须在 Pop-Location 之前把退出码存进变量！
    #    PowerShell 的 $LASTEXITCODE 会被 finally 块里随后执行的 cmdlet
    #    （此处是 Pop-Location）覆盖，导致明明 BUILD SUCCESSFUL 却被误判为失败。
    $gradleExit = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($gradleExit -ne 0) { throw "Gradle 编译失败（退出码 $gradleExit），请查看上方错误。" }
Ok '编译成功。'

# ============================================================
#  步骤 5/5 — 收集 APK
# ============================================================
Step '步骤 5/5  收集 APK'
$src = Join-Path $ProjectDir 'app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $src)) { throw "找不到编译产物：$src" }
Copy-Item $src $ApkOut -Force

Write-Host ''
Ok '✅ 完成！APK 已生成：'
Write-Host $ApkOut -ForegroundColor Yellow
Write-Host ''
Write-Host '把该文件拷到安卓手机，在「设置 → 安全/隐私 → 安装未知来源应用」中允许后安装即可使用。' -ForegroundColor White
