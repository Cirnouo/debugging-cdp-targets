export function formatAppElapsed(timestamp: unknown, now: number): string {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0 || !Number.isFinite(now))
        return 'Unavailable';
    const seconds = Math.floor(Math.max(0, now - timestamp) / 1000);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
        .map((part) => String(part).padStart(2, '0'))
        .join(':');
}
