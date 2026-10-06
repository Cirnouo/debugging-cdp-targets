import assert from 'node:assert/strict';
import { errorMessage, isRecord } from '../../src/shared/errors.ts';
import {
    assertWindowState,
    readWindowSample,
    type WindowBounds,
    type WindowIdentity,
    type WindowSample,
} from './window-evidence.ts';

interface BackgroundAnchorIo {
    launch(bounds: WindowBounds): Promise<WindowIdentity>;
    sample(identity: WindowIdentity, handle?: number, signal?: AbortSignal): Promise<unknown>;
    foreground(identity: WindowIdentity, handle: number): Promise<unknown>;
    background(identity: WindowIdentity, handle: number): Promise<unknown>;
    close(identity: WindowIdentity): Promise<unknown>;
    record(kind: string, value: unknown): Promise<void>;
}

export function createScreenshotBackgroundAnchor(io: BackgroundAnchorIo) {
    let owned: WindowIdentity | undefined;
    let ownedHandle: number | undefined;
    const verify = (raw: unknown, identity: WindowIdentity, handle?: number) => {
        const sample = readWindowSample(raw, identity, handle);
        assert.ok(
            sample.actualExecutablePath && sample.foregroundHwnd !== undefined && sample.bounds,
            'Anchor handoff requires native path, foreground and bounds evidence.',
        );
        assertWindowState(sample, 'normal');
        return sample;
    };
    const covers = (anchor: WindowSample, target: WindowSample) => {
        assert.ok(anchor.bounds && target.bounds);
        assert.ok(
            anchor.bounds.x <= target.bounds.x &&
                anchor.bounds.y <= target.bounds.y &&
                anchor.bounds.x + anchor.bounds.width >= target.bounds.x + target.bounds.width &&
                anchor.bounds.y + anchor.bounds.height >= target.bounds.y + target.bounds.height,
            `Owned anchor bounds do not contain the target window bounds: ${JSON.stringify({ anchor: anchor.bounds, target: target.bounds })}`,
        );
    };
    return {
        async prepare(identity: WindowIdentity, handle: number): Promise<unknown> {
            assert.ok(!owned, 'An anchor is already owned; confirmed cleanup is required before another acquisition.');
            const before = verify(await io.sample(identity, handle), identity, handle);
            assert.ok(before.bounds);
            owned = await io.launch(before.bounds);
            await io.record('anchor-identity', owned);
            const initialRaw = await io.sample(owned);
            await io.record('anchor-before', initialRaw);
            const initial = verify(initialRaw, owned);
            ownedHandle = initial.handle;
            covers(initial, before);
            const foregroundRaw = await io.foreground(owned, initial.handle);
            await io.record('anchor-foreground-transition', foregroundRaw);
            const foreground = verify(foregroundRaw, owned, initial.handle);
            assert.equal(foreground.foregroundHwnd, foreground.handle, 'Owned anchor did not become foreground.');
            covers(foreground, before);
            const targetRaw = await io.sample(identity, handle);
            await io.record('anchor-target-before-background', targetRaw);
            const target = verify(targetRaw, identity, handle);
            assert.equal(target.foregroundHwnd, foreground.handle, 'Owned anchor foreground handoff was lost.');
            covers(foreground, target);
            const raw = await io.background(identity, handle);
            await io.record('anchor-target-background-transition', raw);
            const after = verify(raw, identity, handle);
            assert.equal(after.foregroundHwnd, foreground.handle, 'Owned anchor foreground handoff was lost.');
            covers(foreground, after);
            await io.record('anchor-handoff', {
                anchor: foreground,
                target: after,
                basis: 'Related opaque probe-owned window contains native target bounds; geometric coverage does not prove compositor occlusion and differs from clicking Codex.',
            });
            return raw;
        },
        async observe(identity: WindowIdentity, handle: number, signal?: AbortSignal): Promise<unknown> {
            assert.ok(owned && ownedHandle !== undefined, 'Owned anchor observation is unavailable.');
            const raw = await io.sample(identity, handle, signal);
            const target = verify(raw, identity, handle);
            const anchorRaw = await io.sample(owned, ownedHandle, signal);
            const anchor = verify(anchorRaw, owned, ownedHandle);
            assert.equal(anchor.foregroundHwnd, anchor.handle, 'Owned anchor lost foreground.');
            assert.equal(target.foregroundHwnd, anchor.handle, 'Target background handoff was lost.');
            covers(anchor, target);
            await io.record('anchor-passive-observation', { anchor, target });
            return raw;
        },
        async cleanup(): Promise<unknown> {
            if (!owned) return { anchorNotAcquired: true };
            const identity = owned;
            let result: unknown;
            try {
                result = await io.close(identity);
            } catch (error) {
                await io.record('anchor-normal-close-error', {
                    identity,
                    handle: ownedHandle,
                    error: errorMessage(error),
                });
                throw error;
            }
            await io.record('anchor-normal-close', { identity, result });
            assert.ok(
                isRecord(result) && result.processExited === true,
                'Anchor normal Close lacks actual process exit evidence.',
            );
            owned = undefined;
            ownedHandle = undefined;
            return result;
        },
    };
}
