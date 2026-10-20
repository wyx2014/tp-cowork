param([Parameter(Mandatory)][string]$InstallerDirectory)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Run the real product installation check on a disposable GitHub Actions runner.' }
$installers = @(Get-ChildItem -LiteralPath $InstallerDirectory -Filter '*.exe' -File)
if ($installers.Count -ne 1) { throw "Expected one installer, found $($installers.Count)" }
$scratch = [IO.Directory]::CreateTempSubdirectory('tp-install-').FullName
$application = Join-Path $scratch 'TP Cowork'
$uninstaller = Join-Path $application 'Uninstall TP Cowork.exe'
$productSmoke = Join-Path $PSScriptRoot 'smoke-windows-product.mjs'

function Invoke-InstallerProcess([string]$Executable, [string]$Arguments) {
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    try {
        if (-not $process.WaitForExit(300000)) {
            $process.Kill($true)
            $process.WaitForExit()
            throw 'Installer process did not exit within five minutes.'
        }
        Write-Output "Installer exit code: $($process.ExitCode)"
        if ($process.ExitCode -ne 0) { throw "Installer process failed with exit code $($process.ExitCode)." }
    } finally { $process.Dispose() }
}

try {
    foreach ($mode in @('first installation', 'same-directory upgrade')) {
        Write-Output "Checking $mode at $application"
        # NSIS requires /D last and unquoted, even when the path contains spaces.
        Invoke-InstallerProcess $installers[0].FullName ("/S /D=" + $application)
        $hadElectronMode = Test-Path Env:ELECTRON_RUN_AS_NODE
        $previousElectronMode = $env:ELECTRON_RUN_AS_NODE
        try {
            $env:ELECTRON_RUN_AS_NODE = '1'
            & (Join-Path $application 'TP Cowork.exe') $productSmoke (Join-Path $application 'resources')
            if ($LASTEXITCODE -ne 0) { throw "Installed product smoke failed with exit code $LASTEXITCODE" }
        } finally {
            if ($hadElectronMode) { $env:ELECTRON_RUN_AS_NODE = $previousElectronMode }
            else { Remove-Item Env:ELECTRON_RUN_AS_NODE }
        }
        $residue = @(Get-ChildItem -LiteralPath $scratch -Directory | Where-Object Name -ne 'TP Cowork')
        if ($residue.Count -ne 0) { throw 'Installer left staging or backup directories after success.' }
        Write-Output "TP Cowork: $mode and installed product verified"
    }
} finally {
    if (Test-Path -LiteralPath $uninstaller) {
        Invoke-InstallerProcess $uninstaller ("/S _?=" + $application)
    }
    Remove-Item -LiteralPath $scratch -Recurse -Force
}
