import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    parseDeploymentInstallation,
    parseDeploymentState,
    transitionDeploymentState,
} from '../src/domains/app-deployment.ts';

const identity = '1'.repeat(64);
const selection = { selectedBuildId: 'a'.repeat(64), selectedManifestSha256: 'b'.repeat(64) };
const active = { schemaVersion: 1, installationIdentity: identity, phase: 'active', ...selection };
const installation = {
    schemaVersion: 1,
    installationId: '0dd7224c-51a2-41b3-914d-01171c139ac2',
    kind: 'portable',
    platform: 'linux',
    architecture: 'x64',
    root: { realPath: '/owned/application', device: '12', inode: '34' },
};

test('installation metadata refuses malformed, future and nonphysical root identities', () => {
    assert.deepEqual(parseDeploymentInstallation(installation), installation);
    for (const change of [
        { schemaVersion: 2 },
        { installationId: 'copied-id' },
        { kind: 'system' },
        { platform: 'freebsd' },
        { architecture: 'ia32' },
        { ownerVerified: true },
        { root: { ...installation.root, realPath: '../application' } },
        { root: { ...installation.root, realPath: '/owned/../application' } },
        { root: { ...installation.root, inode: '0' } },
        { root: { ...installation.root, device: 12 } },
    ])
        assert.throws(() => parseDeploymentInstallation({ ...installation, ...change }));
    const parsed = parseDeploymentInstallation(structuredClone(installation));
    assert.equal(Object.isFrozen(parsed.root), true);
});

test('state parsing rejects foreign identity, incomplete selection and all unknown fields', () => {
    assert.deepEqual(parseDeploymentState(active, identity), active);
    for (const change of [
        { schemaVersion: 0 },
        { schemaVersion: 2 },
        { phase: 'staging' },
        { installationIdentity: '2'.repeat(64) },
        { selectedBuildId: 'A'.repeat(64) },
        { selectedManifestSha256: '' },
        { previousBuildId: 'c'.repeat(64) },
    ])
        assert.throws(() => parseDeploymentState({ ...active, ...change }, identity));
    assert.throws(() => parseDeploymentState(active, 'foreign'));
});

test('selection changes only while active and both immutable content identities move together', () => {
    const next = transitionDeploymentState(active, {
        type: 'select',
        selectedBuildId: 'c'.repeat(64),
        selectedManifestSha256: 'd'.repeat(64),
    });
    assert.deepEqual(next, { ...active, selectedBuildId: 'c'.repeat(64), selectedManifestSha256: 'd'.repeat(64) });
    assert.deepEqual(active, { schemaVersion: 1, installationIdentity: identity, phase: 'active', ...selection });
    assert.throws(() =>
        transitionDeploymentState(active, {
            type: 'select',
            selectedBuildId: selection.selectedBuildId,
            selectedManifestSha256: 'd'.repeat(64),
        }),
    );
    assert.throws(() =>
        transitionDeploymentState(active, {
            type: 'select',
            selectedBuildId: 'c'.repeat(64),
            selectedManifestSha256: selection.selectedManifestSha256,
        }),
    );
    assert.throws(() => transitionDeploymentState(active, { type: 'select', ...selection, extra: true }));
});

test('removal fences preserve selection and require explicit cancellation or completion', () => {
    const removing = transitionDeploymentState(active, { type: 'begin-removal' });
    assert.deepEqual(removing, { ...active, phase: 'removing' });
    assert.throws(() =>
        transitionDeploymentState(removing, {
            type: 'select',
            selectedBuildId: 'c'.repeat(64),
            selectedManifestSha256: 'd'.repeat(64),
        }),
    );
    assert.throws(() => transitionDeploymentState(active, { type: 'finish-removal' }));
    assert.throws(() => transitionDeploymentState(active, { type: 'cancel-removal' }));
    assert.deepEqual(transitionDeploymentState(removing, { type: 'cancel-removal' }), active);
    const removed = transitionDeploymentState(removing, { type: 'finish-removal' });
    assert.deepEqual(removed, { ...active, phase: 'removed' });
    for (const type of ['begin-removal', 'cancel-removal', 'finish-removal']) {
        assert.throws(() => transitionDeploymentState(removed, { type }));
    }
    assert.throws(() => transitionDeploymentState(removing, { type: 'begin-removal' }));
});
