const SECOND = 1_000_000_000n;
const MILLISECOND = 1_000_000n;
const MODULUS = 1n << 64n;
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const DATE_LIMIT = 8_640_000_000_000_000n;
export type LinuxInterval = { lowerNs: bigint; upperNs: bigint };
export type LinuxCalibration = LinuxInterval & { uptimeUpperNs: bigint; beforeUtcMs: number; afterUtcMs: number };

export interface LinuxBirthTrace {
    branch?: 'divide' | 'multiply-512' | 'multiply-9' | 'input-rejected';
    result?: 'present' | 'input-rejected' | 'zero-divisor' | 'range-rejected' | 'empty';
    readerUpperNs?: bigint;
    interval?: LinuxInterval;
}
export interface LinuxCalibrationTrace {
    phase?: 'clock' | 'reading' | 'complete';
    failure?: 'read-or-abort' | 'bracket-or-text-invalid' | 'uptime-out-of-range';
}
export interface LinuxPublicTrace {
    absolute?: LinuxInterval;
    branch?:
        | 'invalid-clock'
        | 'containment-or-order-rejected'
        | 'point-or-date-range-rejected'
        | 'date-roundtrip-rejected'
        | 'accepted';
    pointMs?: bigint;
}
export interface LinuxIntersectionTrace {
    interval?: LinuxInterval;
}

// These traces are internally owned plain data; their failure never changes arithmetic.
function trace<T extends object>(target: T | undefined, fields: Partial<T>) {
    try {
        if (target) Object.assign(target, fields);
    } catch {
        /* diagnostic only */
    }
}
function minimum(a: bigint, b: bigint) {
    return a < b ? a : b;
}
function ceiling(a: bigint, b: bigint) {
    return a / b + (a % b > 0n ? 1n : 0n);
}

/** Conservative hull under the kernel proc source contract, not proof that an arbitrary q has an inverse.
 * https://github.com/torvalds/linux/blob/v6.8/kernel/time/time.c#L733-L747
 */
export function linuxBirthInterval(
    {
        rawTicks: q,
        clkTck: h,
        readerBirthUpperNs: x,
    }: {
        rawTicks: bigint;
        clkTck: bigint;
        readerBirthUpperNs: bigint;
    },
    observation?: LinuxBirthTrace,
): LinuxInterval | undefined {
    trace(observation, { readerUpperNs: x });
    if (q < 0n || q > SAFE || h <= 0n || h > SAFE || x < 0n || x >= MODULUS) {
        trace(observation, { branch: 'input-rejected', result: 'input-rejected' });
        return;
    }
    if (SECOND % h === 0n) {
        trace(observation, { branch: 'divide' });
        const divisor = SECOND / h;
        const lowerNs = q * divisor;
        const upperNs = minimum(x, (q + 1n) * divisor - 1n);
        const interval = lowerNs <= upperNs ? { lowerNs, upperNs } : undefined;
        trace(observation, { result: interval ? 'present' : 'empty', ...(interval ? { interval } : {}) });
        return interval;
    }
    const multiplier = h % 512n === 0n ? h : 9n;
    const divisor = h % 512n === 0n ? SECOND : (9n * SECOND + h / 2n) / h;
    trace(observation, { branch: multiplier === 9n ? 'multiply-9' : 'multiply-512' });
    if (divisor === 0n) {
        trace(observation, { result: 'zero-divisor' });
        return;
    }
    const left = q * divisor;
    const right = minimum((q + 1n) * divisor - 1n, MODULUS - 1n);
    if (left >= MODULUS || right < left || multiplier * x < left) {
        trace(observation, { result: 'range-rejected' });
        return;
    }
    const lastWrap = (multiplier * x - left) / MODULUS;
    const lowerNs = ceiling(left, multiplier);
    const upperNs = minimum(x, (lastWrap * MODULUS + right) / multiplier);
    const interval = lowerNs <= upperNs ? { lowerNs, upperNs } : undefined;
    trace(observation, { result: interval ? 'present' : 'empty', ...(interval ? { interval } : {}) });
    return interval;
}

export async function readLinuxCalibration(
    readText: (file: string) => Promise<string>,
    now: () => number,
    observation?: LinuxCalibrationTrace,
): Promise<LinuxCalibration> {
    trace(observation, { phase: 'clock' });
    const before = now();
    trace(observation, { phase: 'reading' });
    let text: string;
    try {
        text = await readText('/proc/uptime');
    } catch (error) {
        trace(observation, { failure: 'read-or-abort' });
        throw error;
    }
    trace(observation, { phase: 'clock' });
    const after = now();
    const match = /^(\d+)\.(\d{2})[ \t]+\d+\.\d{2}\n?$/.exec(text);
    if (!match || !Number.isSafeInteger(before) || !Number.isSafeInteger(after) || before < 0 || after < before) {
        trace(observation, { failure: 'bracket-or-text-invalid' });
        throw new Error('The Linux clock calibration is unverifiable.');
    }
    const uptimeNs = BigInt(match[1] ?? '') * SECOND + BigInt(match[2] ?? '') * 10_000_000n;
    const uptimeUpperNs = uptimeNs + 9_999_999n;
    if (uptimeUpperNs >= MODULUS) {
        trace(observation, { failure: 'uptime-out-of-range' });
        throw new Error('The Linux clock calibration is unverifiable.');
    }
    trace(observation, { phase: 'complete' });
    return {
        lowerNs: BigInt(before) * MILLISECOND - uptimeNs - 10_000_000n,
        upperNs: (BigInt(after) + 1n) * MILLISECOND - uptimeNs,
        uptimeUpperNs,
        beforeUtcMs: before,
        afterUtcMs: after,
    };
}

export function intersectLinuxIntervals(...intervals: LinuxInterval[]): LinuxInterval | undefined {
    return tracedLinuxIntersection(undefined, ...intervals);
}
export function tracedLinuxIntersection(
    observation: LinuxIntersectionTrace | undefined,
    ...intervals: LinuxInterval[]
): LinuxInterval | undefined {
    let lowerNs = intervals[0]?.lowerNs;
    let upperNs = intervals[0]?.upperNs;
    if (lowerNs === undefined || upperNs === undefined) return;
    for (const interval of intervals) {
        if (interval.lowerNs > lowerNs) lowerNs = interval.lowerNs;
        if (interval.upperNs < upperNs) upperNs = interval.upperNs;
    }
    trace(observation, { interval: { lowerNs, upperNs } });
    return lowerNs <= upperNs ? { lowerNs, upperNs } : undefined;
}

export function linuxPublicTime(
    interval: LinuxInterval,
    requestUtc: number,
    decisionUtc: number,
    observation?: LinuxPublicTrace,
): string | undefined {
    trace(observation, { absolute: interval });
    if (!Number.isSafeInteger(requestUtc) || !Number.isSafeInteger(decisionUtc) || decisionUtc < requestUtc) {
        trace(observation, { branch: 'invalid-clock' });
        return;
    }
    if (
        interval.lowerNs > interval.upperNs ||
        interval.lowerNs < (BigInt(requestUtc) - 1_000n) * MILLISECOND ||
        interval.upperNs > (BigInt(decisionUtc) + 1_000n) * MILLISECOND
    ) {
        trace(observation, { branch: 'containment-or-order-rejected' });
        return;
    }
    const point = ceiling(interval.lowerNs, MILLISECOND);
    trace(observation, { pointMs: point });
    if (point < -DATE_LIMIT || point > DATE_LIMIT || point * MILLISECOND > interval.upperNs) {
        trace(observation, { branch: 'point-or-date-range-rejected' });
        return;
    }
    const date = new Date(Number(point));
    const result = date.getTime() === Number(point) ? date.toISOString() : undefined;
    trace(observation, { branch: result ? 'accepted' : 'date-roundtrip-rejected' });
    return result;
}
