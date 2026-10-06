import assert from 'node:assert/strict';
import { isRecord } from '../../src/shared/errors.ts';
import { closeEvery } from '../smoke/screenshot-fixture.ts';
import type { WindowBounds, WindowIdentity } from '../smoke/window-evidence.ts';

export function createOwnedNativeFixtures(io: {
    launch(bounds: WindowBounds): Promise<WindowIdentity>;
    ready(identity: WindowIdentity): Promise<void>;
    close(identity: WindowIdentity): Promise<unknown>;
}) {
    const owned = new Map<number, WindowIdentity>();
    const close = async (identity: WindowIdentity) => {
        assert.deepEqual(owned.get(identity.processId), identity, 'Native fixture Close identity is not retained.');
        const result = await io.close(identity);
        assert.ok(
            isRecord(result) && result.processExited === true,
            'Native fixture Close lacks actual exit evidence.',
        );
        owned.delete(identity.processId);
        return result;
    };
    return {
        async start(bounds: WindowBounds) {
            const identity = await io.launch(bounds);
            owned.set(identity.processId, identity);
            await io.ready(identity);
            return identity;
        },
        close,
        cleanup: () => closeEvery([...owned.values()].map((identity) => () => close(identity))),
    };
}
