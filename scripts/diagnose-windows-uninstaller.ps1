param([Parameter(Mandatory)][string]$Application, [Parameter(Mandatory)][string]$Scratch)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Native uninstall diagnostics require a disposable Windows Actions runner.' }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativeUninstallButtons {
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    public static void Click(IntPtr button) {
        if (!PostMessage(GetParent(button), 0x111, (IntPtr)GetDlgCtrlID(button), button))
            throw new InvalidOperationException("Cannot send the native uninstaller button command.");
    }
}
'@
$executable = Join-Path $Scratch 'diagnostic-uninstaller.exe'
Copy-Item -LiteralPath (Join-Path $Application 'Uninstall TP Cowork.exe') -Destination $executable
$process = Start-Process -FilePath $executable -ArgumentList ('/currentuser --keep-shortcuts --updated _?=' + $Application) -PassThru
$started = $false
$previous = ''
$timer = [Diagnostics.Stopwatch]::StartNew()
try {
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$process.Id)
    while (-not $process.HasExited -and $timer.Elapsed.TotalSeconds -lt 180) {
        $windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $condition)
        foreach ($window in $windows) {
            try {
                $elements = $window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
                $texts = @($elements | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -Last 40)
                $current = ConvertTo-Json -InputObject $texts -Compress
                if ($current -ne $previous) { Write-Output "Native uninstaller page: $current"; $previous = $current }
                foreach ($element in $elements) {
                    if ($element.Current.ControlType.Id -ne [Windows.Automation.ControlType]::Button.Id -or
                        -not $element.Current.IsEnabled) { continue }
                    $name = $element.Current.Name.Replace('&', '').Trim()
                    $advance = $name -match '^(Next\s*>?|Uninstall|Show details)$'
                    $finish = $started -and $name -match '^(Close|Finish)$'
                    if (-not ($advance -or $finish)) { continue }
                    if ($element.Current.NativeWindowHandle -ne 0) {
                        Write-Output "Native uninstaller action: $name"
                        if ($name -eq 'Uninstall') { $started = $true }
                        [NativeUninstallButtons]::Click([IntPtr]$element.Current.NativeWindowHandle)
                        break
                    }
                }
            } catch [Windows.Automation.ElementNotAvailableException] {
                # The installer replaced this page while its controls were being inspected.
            }
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $process.HasExited) { throw 'Native uninstaller UI diagnostics exceeded three minutes.' }
    Write-Output "Native uninstaller exit code: $($process.ExitCode)"
} finally {
    if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
    $process.Dispose()
}
