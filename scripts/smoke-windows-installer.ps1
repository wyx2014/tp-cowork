param([Parameter(Mandatory)][string]$InstallerDirectory, [switch]$CleanMachine, [switch]$Diagnostics)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Run the real product installation check on a disposable GitHub Actions runner.' }
$installers = @(Get-ChildItem -LiteralPath $InstallerDirectory -Filter '*.exe' -File)
if ($installers.Count -ne 1) { throw "Expected one installer, found $($installers.Count)" }
$scratch = [IO.Directory]::CreateTempSubdirectory('tp-install-').FullName
$application = Join-Path $scratch 'TP Cowork'
$uninstaller = Join-Path $application 'Uninstall TP Cowork.exe'
$productSmoke = Join-Path $PSScriptRoot 'smoke-windows-product.mjs'
$legacy = Join-Path $scratch 'nanobot'
$legacyMarker = Join-Path $legacy 'uninstaller-called.txt'
# electron-builder UUID v5 for the released nanobot appId com.tparuyi.app.
$legacyGuid = 'b542a9d7-0e9f-56ff-bedf-01b1117d50af'
$legacyKeys = @("HKCU:\Software\$legacyGuid", "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$legacyGuid")
$ownedLegacyKeys = @()
$failure = $null

function Write-InstallerProgress([int]$InstallerProcessId, [int]$ElapsedSeconds) {
    try {
        $processes = @(Get-CimInstance Win32_Process)
        $owned = [Collections.Generic.HashSet[uint32]]::new()
        [void]$owned.Add([uint32]$InstallerProcessId)
        do {
            $added = $false
            foreach ($entry in $processes) {
                if ($owned.Contains([uint32]$entry.ParentProcessId) -and $owned.Add([uint32]$entry.ProcessId)) { $added = $true }
            }
        } while ($added)
        $snapshot = @($processes | Where-Object { $owned.Contains([uint32]$_.ProcessId) } |
            Select-Object ProcessId, ParentProcessId, Name, KernelModeTime, UserModeTime, ReadTransferCount, WriteTransferCount, ExecutablePath)
        Write-Output ("Installer still running after ${ElapsedSeconds}s: " + (ConvertTo-Json -InputObject $snapshot -Depth 3 -Compress))
        $windows = @(Get-Process -Id @($owned) -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0 |
            Select-Object Id, MainWindowTitle, Responding)
        Write-Output ("Installer windows: " + (ConvertTo-Json -InputObject $windows -Compress))
    } catch { Write-Warning "Cannot inspect installer progress: $_" }
}

function Invoke-InstallerProcess([string]$Executable, [string]$Arguments) {
    Write-Output "Running $Executable"
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru -NoNewWindow
    try {
        $elapsed = [Diagnostics.Stopwatch]::StartNew()
        # The stock upgrader moves installed files aside individually before extracting the replacement.
        while (-not $process.WaitForExit(30000)) {
            Write-InstallerProgress $process.Id ([int]$elapsed.Elapsed.TotalSeconds)
            if ($process.HasExited) { break }
            if ($elapsed.Elapsed.TotalMinutes -ge 15) {
                $process.Kill($true)
                $process.WaitForExit()
                throw 'Installer process did not exit within fifteen minutes; see the preceding process diagnostics.'
            }
        }
        Write-Output ("Installer finished after {0:N1}s" -f $elapsed.Elapsed.TotalSeconds)
        Write-Output "Installer exit code: $($process.ExitCode)"
        if ($process.ExitCode -ne 0) { throw "Installer process failed with exit code $($process.ExitCode)." }
    } finally { $process.Dispose() }
}

try {
    if (-not $Diagnostics) {
        New-Item -ItemType Directory -Path $legacy | Out-Null
        $markerLiteral = '@"' + $legacyMarker.Replace('"', '""') + '"'
        $source = Join-Path $legacy 'uninstaller.cs'
        $legacyUninstaller = Join-Path $legacy 'Uninstall TPCowork.exe'
        Set-Content -LiteralPath $source -Value ('class Probe { static int Main() { System.IO.File.WriteAllText(' + $markerLiteral + ', "called"); return 2; } }')
        & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe "/out:$legacyUninstaller" $source
        if ($LASTEXITCODE -ne 0) { throw 'Cannot build the legacy uninstaller probe.' }
        foreach ($key in $(if ($CleanMachine) { @() } else { $legacyKeys })) {
            if (Test-Path -LiteralPath $key) { throw 'The legacy application is already registered on this runner.' }
            New-Item -Path $key -Force | Out-Null
            $ownedLegacyKeys += $key
            New-ItemProperty -LiteralPath $key -Name InstallLocation -Value $legacy | Out-Null
            New-ItemProperty -LiteralPath $key -Name UninstallString -Value ('"' + $legacyUninstaller + '"') | Out-Null
        }
    }
    $modes = if ($Diagnostics) { @('feature diagnostics') } else { @('first installation', 'same-directory upgrade', 'legacy-profile upgrade') }
    foreach ($mode in $modes) {
        Write-Output "Checking $mode at $application"
        # NSIS requires /D last and unquoted, even when the path contains spaces.
        Invoke-InstallerProcess $installers[0].FullName ("/S /D=" + $application)
        if (-not $Diagnostics) {
            $hadElectronMode = Test-Path Env:ELECTRON_RUN_AS_NODE
            $previousElectronMode = $env:ELECTRON_RUN_AS_NODE
            try {
                $env:ELECTRON_RUN_AS_NODE = '1'
                Invoke-InstallerProcess (Join-Path $application 'TP Cowork.exe') ('--expose-internals "' + $productSmoke + '" "' + (Join-Path $application 'resources') + '"')
            } finally {
                if ($hadElectronMode) { $env:ELECTRON_RUN_AS_NODE = $previousElectronMode }
                else { Remove-Item Env:ELECTRON_RUN_AS_NODE }
            }
        }
        $uiScript = if ($Diagnostics) { 'smoke-windows-features.mjs' } else { 'smoke-windows-ui.mjs' }
        $profileName = if ($mode -eq 'legacy-profile upgrade') { 'legacy-profile' } else { 'profile' }
        $uiArguments = @((Join-Path $PSScriptRoot $uiScript), (Join-Path $application 'TP Cowork.exe'), (Join-Path $scratch $profileName), (Join-Path $PSScriptRoot "../test-results/windows-install/$mode"))
        if ($mode -eq 'legacy-profile upgrade') { $uiArguments += '--legacy-profile' }
        & node @uiArguments
        if ($LASTEXITCODE -ne 0) { throw "Installed product $mode UI verification failed." }
        if (Test-Path -LiteralPath $legacyMarker) { throw 'The DSH installer invoked the nanobot uninstaller.' }
        foreach ($key in $ownedLegacyKeys) {
            if ((Get-ItemPropertyValue -LiteralPath $key -Name InstallLocation) -ne $legacy) { throw 'The DSH installer replaced the nanobot registration.' }
        }
        $residue = @(Get-ChildItem -LiteralPath $scratch -Directory | Where-Object Name -notin @('TP Cowork', 'nanobot', 'profile', 'legacy-profile'))
        if ($residue.Count -ne 0) { throw 'Installer left staging or backup directories after success.' }
        Write-Output "TP Cowork: $mode and installed product verified"
    }
} catch {
    $failure = $_
    if (Test-Path -LiteralPath $legacyMarker) { Write-Output 'Legacy nanobot uninstaller was invoked by the DSH installer.' }
} finally {
    try {
        if (Test-Path -LiteralPath $uninstaller) {
            Invoke-InstallerProcess $uninstaller ("/S _?=" + $application)
        }
    } catch {
        if ($null -eq $failure) { $failure = $_ }
        else { Write-Warning "Cleanup failed: $_" }
    } finally {
        foreach ($key in $ownedLegacyKeys) { Remove-Item -LiteralPath $key -Recurse -Force }
        Remove-Item -LiteralPath $scratch -Recurse -Force
    }
}
if ($null -ne $failure) { throw $failure }
