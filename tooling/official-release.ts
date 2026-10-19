import { readFileSync } from 'node:fs';
import { parseOfficialReleaseEvidence } from '../src/gateway/official/release-evidence.ts';

/** Reviewed App delivery input; thin host payload policy has no official-runtime dependency. */
export const OFFICIAL_RELEASE = parseOfficialReleaseEvidence(
    JSON.parse(readFileSync(new URL('./official-server-release.json', import.meta.url), 'utf8')),
);
