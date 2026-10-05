[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [int] $ApplicationPid,
    [ValidateSet('None', 'Minimize', 'Restore')] [string] $State = 'None',
    [string] $ExecutablePath = '',
    [string] $StartedAtUtc = '',
    [long] $WindowHandle = 0
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($State -ne 'None' -and (!$ExecutablePath -or !$StartedAtUtc)) {
    throw 'Window mutation requires the launched executable and creation time.'
}
Add-Type -Path (Join-Path $PSScriptRoot '../../src/adapters/windows-native-process.cs') -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Xml.dll'
$application = $null
try { $application = [DctNative]::Inspect($ApplicationPid) }
catch {
    if ($State -eq 'None' -and !$ExecutablePath -and !$StartedAtUtc) {
        if (!([Diagnostics.Process]::GetProcesses() | Where-Object { $_.Id -eq $ApplicationPid })) {
            ConvertTo-Json -InputObject @() -Compress
            return
        }
    }
    throw
}
try {
    # .NET Framework expands 8.3 aliases; compare both paths under the same contract.
    if ($ExecutablePath -and ![string]::Equals([IO.Path]::GetFullPath($ExecutablePath), [IO.Path]::GetFullPath($application.ExecutablePath), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The window process executable identity changed.'
    }
    if ($StartedAtUtc -and [DateTimeOffset]::Parse($StartedAtUtc).UtcTicks -ne $application.CreatedTicks) {
        throw 'The window process creation time changed.'
    }
    Add-Type @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class DctWindowEvidence {
    public delegate bool Visitor(IntPtr window, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Placement {
        public int Length, Flags, ShowCmd; public Point Min, Max; public Rect Normal;
    }
    [DllImport("user32.dll")] static extern bool EnumWindows(Visitor visitor, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Visitor visitor, IntPtr parameter);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll", SetLastError = true)] static extern bool GetWindowPlacement(IntPtr window, ref Placement placement);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rectangle);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder value, int count);
    [DllImport("user32.dll", SetLastError = true)] static extern bool ShowWindowAsync(IntPtr window, int state);
    static int Owner(IntPtr window) { int pid; GetWindowThreadProcessId(window, out pid); return pid; }
    static int ShowState(IntPtr window) {
        Placement placement = new Placement(); placement.Length = Marshal.SizeOf(typeof(Placement));
        if (!GetWindowPlacement(window, ref placement)) throw new InvalidOperationException("Window placement is unavailable.");
        return placement.ShowCmd;
    }
    public static object[] Read(int pid, int state, long selected) {
        List<IntPtr> roots = new List<IntPtr>();
        EnumWindows(delegate(IntPtr window, IntPtr unused) {
            if (Owner(window) == pid && IsWindowVisible(window)) roots.Add(window);
            return true;
        }, IntPtr.Zero);
        if (selected != 0 && !roots.Contains(new IntPtr(selected))) throw new InvalidOperationException("Selected window handle is absent or foreign.");
        if (state != 0 && selected == 0 && roots.Count != 1) throw new InvalidOperationException("Select one owned window handle before mutation.");
        if (state != 0 && selected == 0) selected = roots[0].ToInt64();
        List<object> items = new List<object>();
        Action<IntPtr, bool> record = delegate(IntPtr window, bool child) {
            int owner = Owner(window);
            if (owner != pid) return;
            bool before = IsIconic(window); int beforeShow = child ? 0 : ShowState(window);
            bool? accepted = null; int error = 0; bool reached = true;
            if (!child && state != 0 && IsWindowVisible(window) && (selected == 0 || selected == window.ToInt64())) {
                accepted = ShowWindowAsync(window, state);
                error = accepted.Value ? 0 : Marshal.GetLastWin32Error();
                Stopwatch elapsed = Stopwatch.StartNew();
                while (accepted.Value && IsWindow(window) && Owner(window) == pid && IsIconic(window) != (state == 6) && elapsed.ElapsedMilliseconds < 5000) Thread.Sleep(25);
                reached = accepted.Value && IsWindow(window) && Owner(window) == pid && IsIconic(window) == (state == 6);
            }
            if (!IsWindow(window) || Owner(window) != pid) throw new InvalidOperationException("Window identity changed during observation.");
            Rect rectangle; GetWindowRect(window, out rectangle);
            StringBuilder name = new StringBuilder(256); GetClassName(window, name, 256);
            items.Add(new { handle = window.ToInt64(), processId = owner, child, visible = IsWindowVisible(window),
                windowClass = name.ToString(), x = rectangle.Left, y = rectangle.Top,
                width = rectangle.Right - rectangle.Left, height = rectangle.Bottom - rectangle.Top,
                isIconic = IsIconic(window), showCmd = child ? 0 : ShowState(window),
                previousIsIconic = before, previousShowCmd = beforeShow,
                actionAccepted = accepted, nativeError = error, stateReached = reached });
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
    $showState = if ($State -eq 'Minimize') { 6 } elseif ($State -eq 'Restore') { 9 } else { 0 }
    # Return the verified caller spelling so the TypeScript sampler can compare it strictly.
    $verifiedExecutablePath = if ($ExecutablePath) { $ExecutablePath } else { $application.ExecutablePath }
    $windows = @([DctWindowEvidence]::Read($ApplicationPid, $showState, $WindowHandle) | ForEach-Object {
        $_ | Add-Member -NotePropertyName executablePath -NotePropertyValue $verifiedExecutablePath -PassThru |
            Add-Member -NotePropertyName actualExecutablePath -NotePropertyValue $application.ExecutablePath -PassThru |
            Add-Member -NotePropertyName startedAtUtc -NotePropertyValue $application.StartedAtUtc -PassThru
    })
    ConvertTo-Json -InputObject $windows -Depth 5 -Compress
}
finally { $application.Dispose() }
