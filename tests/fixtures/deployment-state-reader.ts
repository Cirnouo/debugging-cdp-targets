import type { DeploymentLease } from '../../src/adapters/app-deployment.ts';
import { isRecord } from '../../src/shared/errors.ts';
import { deploymentAdvisoryLock } from './deployment-advisory-lock.ts';
import { attachDeploymentStoreFixture } from './deployment-store.ts';

const physical = process.argv[2];
const directory = process.argv[3];
if (!physical || !directory || !process.send) throw new Error('Missing owned deployment reader fixture.');
let command = Promise.withResolvers<number | undefined>();
let busy = true;
let stopping = false;
let nextOrdinal = 1;
const failures: unknown[] = [];
function fail(error: unknown) {
    failures.push(error);
    stopping = true;
    command.resolve(undefined);
}
function receive(message: unknown) {
    if (message === 'stop' && !stopping) {
        stopping = true;
        command.resolve(undefined);
    } else if (
        !stopping &&
        !busy &&
        isRecord(message) &&
        Object.keys(message).length === 2 &&
        message.type === 'sample' &&
        typeof message.ordinal === 'number' &&
        message.ordinal === nextOrdinal &&
        nextOrdinal <= 11
    ) {
        busy = true;
        nextOrdinal++;
        command.resolve(message.ordinal);
    } else fail(new Error('Unexpected reader fixture command or ordinal.'));
}
function disconnected() {
    fail(new Error('Reader fixture parent disconnected.'));
}
process.on('message', receive);
process.on('disconnect', disconnected);
const tryLock = await deploymentAdvisoryLock();
const own = await attachDeploymentStoreFixture(physical, directory);
let use: DeploymentLease | undefined;
try {
    const store = await own.deployment.openDeploymentInstallation(directory, { tryLock });
    use = await store.tryAcquire('use');
    if (!use) throw new Error('Fixture installation is busy.');
    const lease = use;
    let ordinal = 0;
    while (!stopping) {
        const state = await store.read(lease);
        if (state.phase !== 'active') throw new Error('Reader observed unexpected fence.');
        if (stopping) break; // A pending read settles naturally before shutdown.
        // The complete read closed its documents; the same use lease stays held while idle.
        command = Promise.withResolvers<number | undefined>();
        busy = false;
        await new Promise<void>((resolve, reject) => {
            if (!process.send) return reject(new Error('Reader fixture IPC is unavailable.'));
            process.send({ type: 'sample', ordinal, state }, (error: Error | null) => {
                if (error) reject(error);
                else resolve();
            });
        });
        const requested = await command.promise;
        if (requested === undefined) break;
        ordinal = requested;
    }
} catch (error) {
    failures.push(error);
} finally {
    try {
        await use?.release();
    } catch (error) {
        failures.push(error);
    }
    try {
        await own.cleanup();
    } catch (error) {
        failures.push(error);
    }
    process.off('message', receive);
    process.off('disconnect', disconnected);
    if (process.connected) process.disconnect();
}
if (failures.length) throw new AggregateError(failures, 'Reader fixture failed.');
