import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOwnedNativeFixtures } from './fixtures/owned-native-fixtures.ts';
import { createScreenshotBackgroundAnchor } from './smoke/screenshot-background-anchor.ts';

const bounds = { x: 10, y: 20, width: 700, height: 400 };
for (const failedReadiness of [1, 2]) {
    test(`every retained fixture normally Closes after readiness failure on launch ${failedReadiness}`, async () => {
        const exited: number[] = [];
        let launched = 0;
        const fixtures = createOwnedNativeFixtures({
            async launch() {
                return {
                    processId: ++launched,
                    executablePath: 'C:/Fixture/window.exe',
                    startedAtUtc: `2026-10-05T00:00:0${launched}.0000001Z`,
                };
            },
            async ready(identity) {
                if (identity.processId === failedReadiness) throw new Error('Readiness marker missing');
            },
            async close(identity) {
                exited.push(identity.processId);
                return { processExited: true };
            },
        });
        try {
            await fixtures.start(bounds);
            await fixtures.start(bounds);
            assert.fail('The injected readiness failure must stop preparation');
        } catch (error) {
            assert.match(String(error), /Readiness marker/);
        } finally {
            assert.ok((await fixtures.cleanup()).every((receipt) => receipt.status === 'fulfilled'));
        }
        assert.deepEqual(exited, failedReadiness === 1 ? [1] : [1, 2]);
        assert.deepEqual(await fixtures.cleanup(), []);
    });
}

test('controller cleanup removes confirmed anchor ownership and leaves only target cleanup', async () => {
    const exited: number[] = [];
    let launched = 0;
    const fixtures = createOwnedNativeFixtures({
        async launch() {
            return {
                processId: ++launched,
                executablePath: 'C:/Fixture/window.exe',
                startedAtUtc: `2026-10-05T00:00:0${launched}.0000001Z`,
            };
        },
        async ready() {},
        async close(identity) {
            exited.push(identity.processId);
            return { processExited: true };
        },
    });
    const target = await fixtures.start(bounds);
    const controller = createScreenshotBackgroundAnchor({
        launch: (geometry) => fixtures.start(geometry),
        async sample(identity) {
            return [
                {
                    ...identity,
                    actualExecutablePath: identity.executablePath,
                    handle: identity.processId * 100,
                    foregroundHwnd: 200,
                    visible: true,
                    child: false,
                    isIconic: false,
                    showCmd: 1,
                    stateReached: true,
                    actionAccepted: null,
                    nativeError: 0,
                    ...bounds,
                },
            ];
        },
        async foreground(identity) {
            return [
                {
                    ...identity,
                    actualExecutablePath: identity.executablePath,
                    handle: 200,
                    foregroundHwnd: 200,
                    visible: true,
                    child: false,
                    isIconic: false,
                    showCmd: 1,
                    stateReached: true,
                    actionAccepted: true,
                    nativeError: 0,
                    ...bounds,
                },
            ];
        },
        async background(identity) {
            return [
                {
                    ...identity,
                    actualExecutablePath: identity.executablePath,
                    handle: 100,
                    foregroundHwnd: 200,
                    visible: true,
                    child: false,
                    isIconic: false,
                    showCmd: 1,
                    stateReached: true,
                    actionAccepted: true,
                    nativeError: 0,
                    ...bounds,
                },
            ];
        },
        close: (identity) => fixtures.close(identity),
        async record() {},
    });
    await controller.prepare(target, 100);
    await controller.cleanup();
    await fixtures.cleanup();
    assert.deepEqual(exited, [2, 1]);
});

test('uncertain native cleanup retains ownership for a normal Close retry', async () => {
    let attempts = 0;
    const fixtures = createOwnedNativeFixtures({
        async launch() {
            return {
                processId: 1,
                executablePath: 'C:/Fixture/window.exe',
                startedAtUtc: '2026-10-05T00:00:01.0000001Z',
            };
        },
        async ready() {},
        async close() {
            return { processExited: ++attempts > 1 };
        },
    });
    await fixtures.start(bounds);
    assert.equal((await fixtures.cleanup())[0]?.status, 'rejected');
    assert.equal((await fixtures.cleanup())[0]?.status, 'fulfilled');
    assert.equal(attempts, 2);
});
