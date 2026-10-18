import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { openDeploymentInstallation } from '../../src/adapters/app-deployment.ts';
import { loadAppAdvisoryLock } from '../../src/adapters/app-native.ts';
import { parseAppNativeEvidence } from '../../src/domains/app-release.ts';

const directory = process.argv[2];
if (!directory || !process.send) throw new Error('Missing owned deployment reader fixture.');
const tryLock = await loadAppAdvisoryLock(
    parseAppNativeEvidence(
        JSON.parse(await readFile(new URL('../../tooling/app-native-release.json', import.meta.url), 'utf8')),
    ),
);
const store = await openDeploymentInstallation(directory, { tryLock });
const use = await store.tryAcquire('use');
if (!use) throw new Error('Fixture installation is busy.');
const lease = use;
const samples = new Set<string>();
let rejected = 0;
let stopping = false;
process.on('message', (message: unknown) => {
    if (message !== 'stop') throw new Error('Malformed reader fixture command.');
    stopping = true;
});
async function sample() {
    try {
        const state = await store.read(lease);
        if (state.phase !== 'active') throw new Error('Reader observed unexpected fence.');
        samples.add(`${state.selectedBuildId}:${state.selectedManifestSha256}`);
    } catch (error) {
        if (!(error instanceof Error) || !/document identity.*changed/.test(error.message)) throw error;
        // Concurrent replacement may invalidate named/open evidence; no partial state is returned.
        rejected++;
    }
}
try {
    await sample();
    process.send('ready');
    while (!stopping) {
        await sample();
        await setImmediate();
    }
    await sample();
    process.send({ samples: [...samples], rejected });
} finally {
    await use.release();
    process.disconnect();
}
