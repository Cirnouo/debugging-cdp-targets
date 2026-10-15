import { subscribeFixtureDiagnostics } from '../../src/adapters/fixture-diagnostics.ts';
import { createFixtureArtifacts } from './fixture-artifacts.ts';
import { createReadaheadInitialization, createReadaheadObserver } from './linux-readahead-study.ts';
import { createLinuxStartupWaitSampler } from './linux-startup-wait.ts';

// Query configuration belongs only to this owned Node child; it is never inherited by Chrome/upstream.
try {
    const query = new URL(import.meta.url).searchParams;
    const directory = query.get('directory');
    const fixture = query.get('fixture');
    if (directory && (fixture === 'official-server' || fixture === 'entry-recovery')) {
        const collector = createFixtureArtifacts(directory, fixture, {
            streamOnly: true,
            collectionId: query.get('collectionId'),
        });
        if (!collector.snapshot().collectionRejected) {
            const assigned = query.get('readaheadKb');
            const executable = query.get('readaheadExecutable');
            const initialization =
                process.platform === 'linux' &&
                fixture === 'official-server' &&
                executable &&
                (assigned === '128' || assigned === '1024')
                    ? createReadaheadInitialization(executable, assigned === '128' ? 128 : 1024, (record) =>
                          collector.readahead(record),
                      )
                    : undefined;
            const identity = await initialization?.result;
            const research = identity
                ? createReadaheadObserver(
                      identity,
                      (record) => collector.readahead(record),
                      undefined,
                      assigned === '128' ? 128 : 1024,
                      'gateway',
                  )
                : undefined;
            const sampler =
                process.platform === 'linux'
                    ? createLinuxStartupWaitSampler((record) => collector.linuxWait(record), {
                          enabled: true,
                          resources: true,
                      })
                    : undefined;
            subscribeFixtureDiagnostics(
                (event) => {
                    collector.gateway(event);
                    sampler?.observe(event);
                    research?.observe(event);
                },
                () => collector.rejected(),
                (dispatch) => collector.measure(dispatch),
            );
            process.once('exit', () => collector.finishStream());
            if (initialization)
                process.once('beforeExit', async () => {
                    await initialization.settled();
                    await research?.settled();
                    const costs = [initialization.cost(), ...(research ? [research.cost()] : [])];
                    const complete = costs.every((cost) => cost.cost === 'complete');
                    const now = performance.now();
                    collector.readahead({
                        kind: 'linux-readahead-study',
                        phase: 'observer',
                        outcome: 'verified',
                        clock: 'gateway',
                        assignedKb: assigned === '128' ? 128 : 1024,
                        startedMs: now,
                        endedMs: now,
                        cost: complete ? 'complete' : 'unavailable',
                        reads: costs.reduce((sum, cost) => sum + (cost.reads ?? 0), 0),
                        metadataOps: costs.reduce((sum, cost) => sum + (cost.metadataOps ?? 0), 0),
                        ...(complete ? { bytes: costs.reduce((sum, cost) => sum + (cost.bytes ?? 0), 0) } : {}),
                    });
                });
        }
    }
} catch {
    console.error('Fixture diagnostic preload unavailable (safe initialization failure).');
}
