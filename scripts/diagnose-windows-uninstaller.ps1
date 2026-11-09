param([Parameter(Mandatory)][string]$Application, [Parameter(Mandatory)][string]$Scratch)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Native uninstall diagnostics require a disposable Windows Actions runner.' }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Path (Join-Path $PSScriptRoot 'windows-uninstaller-listview.cs')
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class NativeUninstallButtons {
    private delegate bool WindowVisitor(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowVisitor visitor, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr window, WindowVisitor visitor, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern IntPtr GetDlgItem(IntPtr window, int id);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr SendMessageTimeout(
        IntPtr window, uint message, UIntPtr length, StringBuilder text, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    private static void Click(IntPtr button) {
        if (!PostMessage(GetParent(button), 0x111, (IntPtr)GetDlgCtrlID(button), button))
            throw new InvalidOperationException("Cannot send the native uninstaller button command.");
    }
    private static string Text(IntPtr window) {
        var text = new StringBuilder(2048);
        UIntPtr result;
        SendMessageTimeout(window, 13, new UIntPtr((uint)text.Capacity), text, 2, 100, out result);
        return text.ToString().Replace("&", "").Trim();
    }
    public static string Advance(uint process, bool allowFinish) {
        var windows = new List<IntPtr>();
        EnumWindows((window, parameter) => {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner == process) windows.Add(window);
            return true;
        }, IntPtr.Zero);
        string state = "No native primary button";
        foreach (var window in windows) {
            var primary = GetDlgItem(window, 1);
            if (primary == IntPtr.Zero) continue;
            ShowWindow(window, 1);
            IntPtr details = IntPtr.Zero;
            EnumChildWindows(window, (child, parameter) => {
                if (Text(child) == "Show details" && IsWindowVisible(child) && IsWindowEnabled(child)) details = child;
                return true;
            }, IntPtr.Zero);
            if (details != IntPtr.Zero) { Click(details); return "Click Show details"; }
            var name = Text(primary);
            state = "Primary: " + name + "; enabled=" + IsWindowEnabled(primary);
            if (!IsWindowEnabled(primary)) continue;
            if (name == "Next >" || name == "Next" || name == "Uninstall" ||
                (allowFinish && (name == "Finish" || name == "Close"))) {
                Click(primary);
                return "Click " + name;
            }
        }
        return state;
    }
}
'@
$executable = Join-Path $Scratch 'diagnostic-uninstaller.exe'
Copy-Item -LiteralPath (Join-Path $Application 'Uninstall TP Cowork.exe') -Destination $executable
$process = Start-Process -FilePath $executable -ArgumentList ('/currentuser --keep-shortcuts --updated _?=' + $Application) -PassThru
$started = $false
$previous = ''
$previousAction = ''
$readFailure = $false
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
                if (-not $readFailure -and $texts -contains 'Uninstallation Aborted') {
                    [NativeUninstallDetails]::Read([uint32]$process.Id) | ForEach-Object { Write-Output "Native uninstall detail: $_" }
                    $readFailure = $true
                    throw 'Native uninstaller aborted; failure details were captured above.'
                }
            } catch [Windows.Automation.ElementNotAvailableException] {
                # The installer replaced this page while its controls were being inspected.
            }
        }
        $action = [NativeUninstallButtons]::Advance([uint32]$process.Id, $started)
        if ($action -ne $previousAction) { Write-Output "Native uninstaller action: $action"; $previousAction = $action }
        if ($action -eq 'Click Uninstall') { $started = $true }
        Start-Sleep -Milliseconds 250
    }
    if (-not $process.HasExited) { throw 'Native uninstaller UI diagnostics exceeded three minutes.' }
    Write-Output "Native uninstaller exit code: $($process.ExitCode)"
} finally {
    if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
    $process.Dispose()
}
