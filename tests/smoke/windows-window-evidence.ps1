[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [int] $ApplicationPid,
    [ValidateSet('None', 'Minimize', 'Restore')] [string] $State = 'None'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class DctWindowEvidence {
    public delegate bool Visitor(IntPtr window, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool EnumWindows(Visitor visitor, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Visitor visitor, IntPtr parameter);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rectangle);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder value, int count);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int state);
    public static object[] Read(int pid, int state) {
        List<object> items = new List<object>();
        Action<IntPtr, bool> record = delegate(IntPtr window, bool child) {
            int owner; GetWindowThreadProcessId(window, out owner);
            if (owner != pid) return;
            if (!child && IsWindowVisible(window) && state != 0) ShowWindow(window, state);
            Rect rectangle; GetWindowRect(window, out rectangle);
            StringBuilder name = new StringBuilder(256); GetClassName(window, name, 256);
            items.Add(new { handle = window.ToInt64(), processId = owner, child, visible = IsWindowVisible(window),
                windowClass = name.ToString(), x = rectangle.Left, y = rectangle.Top,
                width = rectangle.Right - rectangle.Left, height = rectangle.Bottom - rectangle.Top });
        };
        EnumWindows(delegate(IntPtr window, IntPtr parameter) {
            int owner; GetWindowThreadProcessId(window, out owner);
            if (owner == pid) {
                record(window, false);
                EnumChildWindows(window, delegate(IntPtr child, IntPtr unused) { record(child, true); return true; }, IntPtr.Zero);
            }
            return true;
        }, IntPtr.Zero);
        return items.ToArray();
    }
}
'@
$showState = if ($State -eq 'Minimize') { 6 } elseif ($State -eq 'Restore') { 4 } else { 0 }
ConvertTo-Json -InputObject @([DctWindowEvidence]::Read($ApplicationPid, $showState)) -Depth 5 -Compress
