import { DEFAULT_BASE_PORT, FIRST_USER_PORT, MAX_PORT } from '../shared/constants.ts';

export type PortRange = readonly [number, number];

export async function choosePort({
    basePort = DEFAULT_BASE_PORT,
    reservedRanges = [],
    probe,
}: {
    basePort?: number;
    reservedRanges?: readonly PortRange[];
    probe: (port: number) => Promise<boolean>;
}) {
    if (!Number.isInteger(basePort) || basePort < 1 || basePort > MAX_PORT) throw new Error('Invalid base port.');
    for (let port = Math.max(basePort, FIRST_USER_PORT); port <= MAX_PORT; port += 1) {
        if (reservedRanges.some(([start, end]) => port >= start && port <= end)) continue;
        if (await probe(port)) return port;
    }
    throw new Error('No available, non-reserved CDP port remains.');
}
