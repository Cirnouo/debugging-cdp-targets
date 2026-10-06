[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [int] $ApplicationPid,
    [ValidateSet('None', 'Minimize', 'Restore', 'Foreground', 'Background')] [string] $State = 'None',
    [string] $ExecutablePath = '',
    [string] $StartedAtUtc = '',
    [long] $WindowHandle = 0
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($State -ne 'None' -and (!$ExecutablePath -or !$StartedAtUtc)) {
    throw 'Window mutation requires the launched executable and creation time.'
}
if ($State -in @('Foreground', 'Background') -and $WindowHandle -le 0) {
    throw 'Controlled conditions require an explicitly verified owned window handle.'
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
using System.IO;
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
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll", SetLastError = true)] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageName(IntPtr handle, uint flags, StringBuilder path, ref uint length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr handle, out long created, out long exited, out long kernel, out long user);
    [DllImport("user32.dll", SetLastError = true)] static extern bool GetWindowPlacement(IntPtr window, ref Placement placement);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rectangle);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder value, int count);
    [DllImport("user32.dll", SetLastError = true)] static extern bool ShowWindowAsync(IntPtr window, int state);
    static int Owner(IntPtr window) { int pid; GetWindowThreadProcessId(window, out pid); return pid; }
    static void Guard(int pid, IntPtr window, string executable, long ticks) {
        IntPtr process = OpenProcess(0x101000, false, pid);
        if (process == IntPtr.Zero) throw new InvalidOperationException("Owned process identity is unavailable.");
        try {
            long created, exited, kernel, user; uint length = 32768; StringBuilder actual = new StringBuilder((int)length);
            if (WaitForSingleObject(process, 0) != 258 || !GetProcessTimes(process, out created, out exited, out kernel, out user) || DateTime.FromFileTimeUtc(created).Ticks != ticks)
                throw new InvalidOperationException("The window process creation time changed or exited.");
            if (!QueryFullProcessImageName(process, 0, actual, ref length) || !String.Equals(Path.GetFullPath(executable), Path.GetFullPath(actual.ToString()), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("The window process executable identity changed.");
            if (!IsWindow(window) || Owner(window) != pid || GetAncestor(window, 2) != window || !IsWindowVisible(window))
                throw new InvalidOperationException("Selected window handle is absent or foreign.");
        } finally { CloseHandle(process); }
    }
    static object Snapshot(int pid, IntPtr window, string executable, long ticks) {
        Guard(pid, window, executable, ticks);
        Rect bounds; if (!GetWindowRect(window, out bounds)) throw new InvalidOperationException("Owned window bounds are unavailable.");
        return new { processId = pid, executablePath = executable, startedAtUtc = new DateTime(ticks, DateTimeKind.Utc).ToString("o"),
            handle = window.ToInt64(), foregroundHwnd = GetForegroundWindow().ToInt64(), isIconic = IsIconic(window), showCmd = ShowState(window), x = bounds.Left, y = bounds.Top, width = bounds.Right - bounds.Left, height = bounds.Bottom - bounds.Top };
    }
    static bool BoundsMatch(IntPtr window, Rect expected) {
        Rect actual;
        return GetWindowRect(window, out actual) && actual.Left == expected.Left && actual.Top == expected.Top && actual.Right == expected.Right && actual.Bottom == expected.Bottom;
    }
    static bool Step(List<object> steps, string action, int pid, IntPtr window, string executable, long ticks, Func<bool> mutate, Func<bool> reached, out int error, out bool accepted) {
        object before = Snapshot(pid, window, executable, ticks);
        // Recheck the complete identity immediately before each native mutation.
        Guard(pid, window, executable, ticks);
        accepted = mutate(); error = accepted ? 0 : Marshal.GetLastWin32Error();
        Stopwatch elapsed = Stopwatch.StartNew();
        while (accepted && elapsed.ElapsedMilliseconds < 5000) {
            Guard(pid, window, executable, ticks);
            if (reached()) break;
            Thread.Sleep(25);
        }
        object after = Snapshot(pid, window, executable, ticks);
        bool observed = accepted && reached();
        steps.Add(new { action, before, after, actionAccepted = accepted, nativeError = error, stateReached = observed });
        return observed;
    }
    static int ShowState(IntPtr window) {
        Placement placement = new Placement(); placement.Length = Marshal.SizeOf(typeof(Placement));
        if (!GetWindowPlacement(window, ref placement)) throw new InvalidOperationException("Window placement is unavailable.");
        return placement.ShowCmd;
    }
    public static object[] Read(int pid, int state, long selected, string executable, long ticks) {
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
            List<object> transitions = new List<object>();
            if (!child && state != 0 && IsWindowVisible(window) && (selected == 0 || selected == window.ToInt64())) {
                bool mutationAccepted;
                if (state == -1) {
                    Guard(pid, window, executable, ticks);
                    if (IsIconic(window) || GetForegroundWindow() == window) throw new InvalidOperationException("Background transition requires an already normal background owned window.");
                    reached = Step(transitions, "bottom-noactivate", pid, window, executable, ticks, () => SetWindowPos(window, new IntPtr(1), 0, 0, 0, 0, 0x13), () => !IsIconic(window) && GetForegroundWindow() != window, out error, out mutationAccepted);
                } else if (state == -2) {
                    Rect normal; if (!GetWindowRect(window, out normal)) throw new InvalidOperationException("Owned window bounds are unavailable.");
                    reached = Step(transitions, "foreground-minimize", pid, window, executable, ticks, () => ShowWindowAsync(window, 6), () => IsIconic(window), out error, out mutationAccepted);
                    if (reached) reached = Step(transitions, "foreground-restore", pid, window, executable, ticks, () => ShowWindowAsync(window, 9), () => !IsIconic(window) && GetForegroundWindow() == window && BoundsMatch(window, normal), out error, out mutationAccepted);
                } else {
                    reached = Step(transitions, state == 6 ? "minimize" : "restore", pid, window, executable, ticks, () => ShowWindowAsync(window, state), () => IsIconic(window) == (state == 6), out error, out mutationAccepted);
                }
                accepted = mutationAccepted;
            }
            if (!IsWindow(window) || Owner(window) != pid) throw new InvalidOperationException("Window identity changed during observation.");
            Rect rectangle; GetWindowRect(window, out rectangle);
            StringBuilder name = new StringBuilder(256); GetClassName(window, name, 256);
            items.Add(new { handle = window.ToInt64(), processId = owner, child, visible = IsWindowVisible(window),
                windowClass = name.ToString(), x = rectangle.Left, y = rectangle.Top,
                width = rectangle.Right - rectangle.Left, height = rectangle.Bottom - rectangle.Top,
                isIconic = IsIconic(window), showCmd = child ? 0 : ShowState(window),
                foregroundHwnd = GetForegroundWindow().ToInt64(), transitions = transitions.ToArray(),
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
    $showState = if ($State -eq 'Minimize') { 6 } elseif ($State -eq 'Restore') { 9 } elseif ($State -eq 'Background') { -1 } elseif ($State -eq 'Foreground') { -2 } else { 0 }
    # Return the verified caller spelling so the TypeScript sampler can compare it strictly.
    $verifiedExecutablePath = if ($ExecutablePath) { $ExecutablePath } else { $application.ExecutablePath }
    $windows = @([DctWindowEvidence]::Read($ApplicationPid, $showState, $WindowHandle, $verifiedExecutablePath, $application.CreatedTicks) | ForEach-Object {
        $_ | Add-Member -NotePropertyName executablePath -NotePropertyValue $verifiedExecutablePath -PassThru |
            Add-Member -NotePropertyName actualExecutablePath -NotePropertyValue $application.ExecutablePath -PassThru |
            Add-Member -NotePropertyName startedAtUtc -NotePropertyValue $application.StartedAtUtc -PassThru
    })
    ConvertTo-Json -InputObject $windows -Depth 8 -Compress
}
finally { $application.Dispose() }
