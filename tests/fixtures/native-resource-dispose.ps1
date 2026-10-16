function Invoke-NativeResourceDisposal {
    param([scriptblock[]] $Actions, [Exception] $Primary = $null)
    $failures = [Collections.Generic.List[Exception]]::new()
    foreach ($action in $Actions) {
        try { & $action } catch { $failures.Add($_.Exception) }
    }
    if ($failures.Count -gt 0) {
        if ($null -ne $Primary) { $failures.Insert(0, $Primary) }
        throw [AggregateException]::new('Native fixture cleanup failed.', $failures.ToArray())
    }
}
