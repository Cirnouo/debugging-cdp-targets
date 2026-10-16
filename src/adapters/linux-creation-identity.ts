const SECOND = 1_000_000_000n;
const MILLISECOND = 1_000_000n;
const MODULUS = 1n << 64n;
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const DATE_LIMIT = 8_640_000_000_000_000n;
export type LinuxInterval = { lowerNs: bigint; upperNs: bigint };
export type LinuxCalibration = LinuxInterval & { uptimeUpperNs: bigint; beforeUtcMs: number; afterUtcMs: number };

function minimum(a: bigint, b: bigint) {
    return a < b ? a : b;
}
function ceiling(a: bigint, b: bigint) {
    return a / b + (a % b > 0n ? 1n : 0n);
}

/** Conservative hull under the kernel proc source contract, not proof that an arbitrary q has an inverse.
 * https://github.com/torvalds/linux/blob/v6.8/kernel/time/time.c#L733-L747
 */
export function linuxBirthInterval({
    rawTicks: q,
    clkTck: h,
    readerBirthUpperNs: x,
}: {
    rawTicks: bigint;
    clkTck: bigint;
    readerBirthUpperNs: bigint;
}): LinuxInterval | undefined {
    if (q < 0n || q > SAFE || h <= 0n || h > SAFE || x < 0n || x >= MODULUS) return;
    if (SECOND % h === 0n) {
        const divisor = SECOND / h;
        const lowerNs = q * divisor;
        const upperNs = minimum(x, (q + 1n) * divisor - 1n);
        return lowerNs <= upperNs ? { lowerNs, upperNs } : undefined;
    }
    const multiplier = h % 512n === 0n ? h : 9n;
    const divisor = h % 512n === 0n ? SECOND : (9n * SECOND + h / 2n) / h;
    if (divisor === 0n) return;
    const left = q * divisor;
    const right = minimum((q + 1n) * divisor - 1n, MODULUS - 1n);
    if (left >= MODULUS || right < left || multiplier * x < left) return;
    const lastWrap = (multiplier * x - left) / MODULUS;
    const lowerNs = ceiling(left, multiplier);
    const upperNs = minimum(x, (lastWrap * MODULUS + right) / multiplier);
    return lowerNs <= upperNs ? { lowerNs, upperNs } : undefined;
}

export async function readLinuxCalibration(
    readText: (file: string) => Promise<string>,
    now: () => number,
): Promise<LinuxCalibration> {
    const before = now();
    const text = await readText('/proc/uptime');
    const after = now();
    const match = /^(\d+)\.(\d{2})[ \t]+\d+\.\d{2}\n?$/.exec(text);
    if (!match || !Number.isSafeInteger(before) || !Number.isSafeInteger(after) || before < 0 || after < before)
        throw new Error('The Linux clock calibration is unverifiable.');
    const uptimeNs = BigInt(match[1] ?? '') * SECOND + BigInt(match[2] ?? '') * 10_000_000n;
    const uptimeUpperNs = uptimeNs + 9_999_999n;
    if (uptimeUpperNs >= MODULUS) throw new Error('The Linux clock calibration is unverifiable.');
    return {
        lowerNs: BigInt(before) * MILLISECOND - uptimeNs - 10_000_000n,
        upperNs: (BigInt(after) + 1n) * MILLISECOND - uptimeNs,
        uptimeUpperNs,
        beforeUtcMs: before,
        afterUtcMs: after,
    };
}

export function intersectLinuxIntervals(...intervals: LinuxInterval[]): LinuxInterval | undefined {
    let lowerNs = intervals[0]?.lowerNs;
    let upperNs = intervals[0]?.upperNs;
    if (lowerNs === undefined || upperNs === undefined) return;
    for (const interval of intervals) {
        if (interval.lowerNs > lowerNs) lowerNs = interval.lowerNs;
        if (interval.upperNs < upperNs) upperNs = interval.upperNs;
    }
    return lowerNs <= upperNs ? { lowerNs, upperNs } : undefined;
}

export function linuxPublicTime(interval: LinuxInterval, requestUtc: number, decisionUtc: number): string | undefined {
    if (!Number.isSafeInteger(requestUtc) || !Number.isSafeInteger(decisionUtc) || decisionUtc < requestUtc) return;
    if (
        interval.lowerNs > interval.upperNs ||
        interval.lowerNs < (BigInt(requestUtc) - 1_000n) * MILLISECOND ||
        interval.upperNs > (BigInt(decisionUtc) + 1_000n) * MILLISECOND
    )
        return;
    const point = ceiling(interval.lowerNs, MILLISECOND);
    if (point < -DATE_LIMIT || point > DATE_LIMIT || point * MILLISECOND > interval.upperNs) return;
    const date = new Date(Number(point));
    return date.getTime() === Number(point) ? date.toISOString() : undefined;
}
