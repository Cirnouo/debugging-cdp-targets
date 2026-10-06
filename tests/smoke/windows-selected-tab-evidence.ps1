[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [int] $ApplicationPid,
    [Parameter(Mandatory = $true)] [string] $ExecutablePath,
    [Parameter(Mandatory = $true)] [string] $StartedAtUtc,
    [Parameter(Mandatory = $true)] [long] $WindowHandle
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -Path (Join-Path $PSScriptRoot '../../src/adapters/windows-native-process.cs') -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Xml.dll'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, Accessibility
Add-Type -ReferencedAssemblies 'Accessibility.dll' @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using Accessibility;
public static class DctPassiveTabs {
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr window, uint id, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object accessible);
    public static int Owner(IntPtr window) { int pid; GetWindowThreadProcessId(window, out pid); return pid; }
    public static string Title(IntPtr window) { StringBuilder text = new StringBuilder(1024); GetWindowText(window, text, text.Capacity); return text.ToString(); }
    public static object ReadMsaa(IntPtr window) {
        Guid iid = new Guid("618736e0-3c3d-11cf-810c-00aa00389b71"); object value;
        int result = AccessibleObjectFromWindow(window, 0xFFFFFFFC, ref iid, out value);
        if (result != 0 || !(value is IAccessible)) throw new InvalidOperationException("Owned HWND MSAA client is unavailable: " + result);
        List<object> tabs = new List<object>(); int budget = 512; bool incomplete = false;
        Read((IAccessible)value, 0, tabs, ref budget, ref incomplete);
        return new { tabs = tabs.ToArray(), incomplete };
    }
    static void Record(IAccessible node, object id, List<object> tabs) {
        if (Convert.ToInt32(node.get_accRole(id)) != 0x25) return;
        int state = Convert.ToInt32(node.get_accState(id));
        tabs.Add(new { name = node.get_accName(id), selected = (state & 2) != 0 });
    }
    static void Read(IAccessible node, int depth, List<object> tabs, ref int budget, ref bool incomplete) {
        if (depth > 8 || budget-- <= 0) { incomplete = true; return; }
        try { Record(node, 0, tabs); } catch { incomplete = true; }
        int children;
        try { children = node.accChildCount; } catch { incomplete = true; return; }
        for (int child = 1; child <= children; child++) {
            if (budget <= 0) { incomplete = true; return; }
            try {
                object nested = node.get_accChild(child);
                if (nested is IAccessible) Read((IAccessible)nested, depth + 1, tabs, ref budget, ref incomplete);
                else { budget--; Record(node, child, tabs); }
            } catch { incomplete = true; }
        }
    }
}
'@
$application = [DctNative]::Inspect($ApplicationPid)
try {
    if (![string]::Equals([IO.Path]::GetFullPath($ExecutablePath), [IO.Path]::GetFullPath($application.ExecutablePath), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Owned HWND executable identity changed.'
    }
    if ([DateTimeOffset]::Parse($StartedAtUtc).UtcTicks -ne $application.CreatedTicks) { throw 'Owned HWND creation time changed.' }
    $owned = [IntPtr]::new($WindowHandle)
    if (![DctPassiveTabs]::IsWindow($owned) -or ![DctPassiveTabs]::IsWindowVisible($owned) -or [DctPassiveTabs]::Owner($owned) -ne $ApplicationPid) {
        throw 'Owned visible HWND identity changed.'
    }
    $uia = @{ status = 'unknown'; tabs = @() }
    try {
        # This tree starts at the verified owned Chrome HWND. No desktop/global tree is queried.
        $element = [Windows.Automation.AutomationElement]::FromHandle($owned)
        $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::TabItem)
        $items = $element.FindAll([Windows.Automation.TreeScope]::Descendants, $condition)
        $tabs = @()
        $incomplete = $false
        foreach ($item in $items) {
            try {
                $pattern = $item.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern)
                $tabs += @{ name = $item.Current.Name; selected = $pattern.Current.IsSelected }
            } catch { $incomplete = $true }
        }
        $uia = @{ status = $(if ($tabs.Count -gt 0 -and !$incomplete) { 'supported' } else { 'unknown' }); tabs = $tabs; incomplete = $incomplete }
    } catch { $uia = @{ status = 'unknown'; tabs = @(); error = $_.Exception.Message } }
    $msaa = @{ status = 'unknown'; tabs = @() }
    try {
        $read = [DctPassiveTabs]::ReadMsaa($owned)
        $msaa = @{ status = $(if ($read.tabs.Length -gt 0 -and !$read.incomplete) { 'supported' } else { 'unknown' }); tabs = @($read.tabs); incomplete = $read.incomplete }
    } catch { $msaa = @{ status = 'unknown'; tabs = @(); error = $_.Exception.Message } }
    if (![DctPassiveTabs]::IsWindow($owned) -or [DctPassiveTabs]::Owner($owned) -ne $ApplicationPid) { throw 'Owned HWND changed during observation.' }
    @{
        ownedHwnd = $WindowHandle
        processId = $ApplicationPid
        executablePath = $application.ExecutablePath
        startedAtUtc = $application.StartedAtUtc
        foregroundHwnd = [DctPassiveTabs]::GetForegroundWindow().ToInt64()
        windowTitle = [DctPassiveTabs]::Title($owned)
        uia = $uia
        msaa = $msaa
    } | ConvertTo-Json -Depth 6 -Compress
}
finally { $application.Dispose() }
