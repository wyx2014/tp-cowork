param([Parameter(Mandatory)][string]$InstallerDirectory, [string]$HarnessDirectory = '../deepseek-harness')
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Interactive installation requires a disposable Windows Actions runner.' }
. (Join-Path $HarnessDirectory 'apps/desktop/tests/windows-installer-ui.ps1')
[InstallerCapture]::Initialize()
[InstallerCapture]::ProductName = 'TP Cowork'
$installers = @(Get-ChildItem -LiteralPath $InstallerDirectory -Filter '*.exe' -File)
if ($installers.Count -ne 1) { throw 'Expected one Windows installer.' }
$evidence = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../test-results/windows-install/interactive'))
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$application = $null
$process = $null
$window = [IntPtr]::Zero
$started = Get-Date

function Wait-InstallerPage([int]$Page) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        if ($process.HasExited) { throw "Installer exited before page $Page, code $($process.ExitCode)" }
        $handle = [InstallerCapture]::Find($process.Id)
        if ($handle -ne [IntPtr]::Zero -and [InstallerCapture]::GetProp($handle, 'HarnessInstaller.Page').ToInt32() -eq $Page) { return $handle }
        Start-Sleep -Milliseconds 100
    } while ($timer.Elapsed.TotalSeconds -lt 300)
    throw "Installer page $Page timed out: $([InstallerCapture]::VisibleText($process.Id))"
}

try {
    # Exercise the user's default path and native pages; do not pass /S or /D.
    $process = Start-Process -FilePath $installers[0].FullName -ArgumentList '/THEME=light' -PassThru
    $window = Wait-InstallerPage 1
    $pathControl = [InstallerCapture]::GetProp($window, 'HarnessInstaller.PathControl')
    $selected = [IO.Path]::GetFullPath([InstallerCapture]::Text($pathControl))
    $programs = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs')) + '\'
    if (-not $selected.StartsWith($programs, [StringComparison]::OrdinalIgnoreCase) -or $selected -eq $programs.TrimEnd('\')) { throw "Unexpected default installation path: $selected" }
    if ((Test-Path -LiteralPath $selected) -and @(Get-ChildItem -LiteralPath $selected -Force).Count -ne 0) { throw 'Default installation directory is not empty; refusing to overwrite it.' }
    $application = $selected
    $welcome = Join-Path $evidence 'welcome.png'
    [void][InstallerCapture]::Save($window, $welcome)
    $bitmap = [Drawing.Bitmap]::FromFile($welcome)
    try {
        $scale = $bitmap.Width / 600.0
        $colored = 0
        for ($y = 190; $y -lt 294; $y += 2) {
            for ($x = 248; $x -lt 352; $x += 2) {
                $pixel = $bitmap.GetPixel([int]($x * $scale), [int]($y * $scale))
                if ([Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B)) - [Math]::Min($pixel.R, [Math]::Min($pixel.G, $pixel.B)) -gt 40) { $colored++ }
            }
        }
        if ($colored -lt 100) { throw 'Installer is missing the colored TP Cowork brand icon; inspect welcome.png.' }
    } finally { $bitmap.Dispose() }
    Write-Output "Interactive installation at $application"
    [InstallerCapture]::Click([InstallerCapture]::GetProp($window, 'HarnessInstaller.PrimaryAction'))
    $window = Wait-InstallerPage 2
    [void][InstallerCapture]::Save($window, (Join-Path $evidence 'finish.png'))
    $launch = [InstallerCapture]::GetProp($window, 'HarnessInstaller.LaunchAction')
    if ([InstallerCapture]::SendMessage($launch, 0xF0, [IntPtr]::Zero, [IntPtr]::Zero).ToInt32() -eq 1) {
        [InstallerCapture]::Click($launch)
        $timer = [Diagnostics.Stopwatch]::StartNew()
        while ([InstallerCapture]::SendMessage($launch, 0xF0, [IntPtr]::Zero, [IntPtr]::Zero).ToInt32() -ne 0) {
            if ($timer.Elapsed.TotalSeconds -gt 5) { throw 'Launch checkbox did not clear.' }
            Start-Sleep -Milliseconds 25
        }
    }
    [InstallerCapture]::Click([InstallerCapture]::GetProp($window, 'HarnessInstaller.PrimaryAction'))
    if (-not $process.WaitForExit(30000) -or $process.ExitCode -ne 0) { throw 'Interactive installer did not finish successfully.' }
    & node (Join-Path $PSScriptRoot 'smoke-windows-ui.mjs') (Join-Path $application 'TP Cowork.exe') (Join-Path $evidence 'profile') $evidence
    if ($LASTEXITCODE -ne 0) { throw 'Interactively installed application did not launch correctly.' }
    @{ installation = $application; defaultPath = $true; silent = $false; result = 'passed' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'installer.json')
} catch {
    if ($process -and -not $process.HasExited) {
        [InstallerCapture]::VisibleText($process.Id) | Set-Content -LiteralPath (Join-Path $evidence 'failure.txt')
        if ($window -ne [IntPtr]::Zero -and [InstallerCapture]::IsWindow($window)) {
            [void][InstallerCapture]::SaveNative($window, (Join-Path $evidence 'failure.png'), $false)
        }
    }
    throw
} finally {
    if ($process) {
        if (-not $process.HasExited) { $process.Kill($true); $process.WaitForExit() }
        $process.Dispose()
    }
    $logRoot = Join-Path $env:LOCALAPPDATA '@deepseek-aidsh-desktop-updater/installer-logs'
    if (Test-Path -LiteralPath $logRoot) {
        Get-ChildItem -LiteralPath $logRoot -File | Where-Object LastWriteTime -ge $started | Copy-Item -Destination $evidence
    }
    if ($application) {
        $uninstaller = Join-Path $application 'Uninstall TP Cowork.exe'
        if (Test-Path -LiteralPath $uninstaller) {
            $cleanup = Start-Process -FilePath $uninstaller -ArgumentList ('/S _?=' + $application) -PassThru
            try {
                if (-not $cleanup.WaitForExit(60000)) { $cleanup.Kill($true); $cleanup.WaitForExit(); throw 'Interactive installation cleanup timed out.' }
                if ($cleanup.ExitCode -ne 0) { throw "Cleanup exited with $($cleanup.ExitCode)" }
            } finally { $cleanup.Dispose() }
        }
        if (Test-Path -LiteralPath $application) { Remove-Item -LiteralPath $application -Recurse -Force }
    }
}
