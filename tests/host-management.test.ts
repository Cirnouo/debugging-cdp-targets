import assert from 'node:assert/strict';
import test from 'node:test';
import { decidePluginUpdate, parseStablePluginRecord, validateAppEndpoint } from '../src/domains/host-management.ts';

const record = {
    schemaVersion: 1,
    version: '0.2.0',
    minimumAppVersion: '0.1.0',
    source: { url: 'https://example.invalid/plugin.git', sha: 'a'.repeat(40) },
};

test('no published record is normal and incompatible latest never searches history', () => {
    assert.equal(
        decidePluginUpdate('0.2.0-rc.2', parseStablePluginRecord({ ...record, minimumAppVersion: '0.2.0-rc.1+build' })),
        'install',
    );
    assert.equal(parseStablePluginRecord(null), null);
    assert.equal(decidePluginUpdate('0.1.0', null, '0.1.0'), 'no-candidate');
    assert.equal(
        decidePluginUpdate('0.1.0', parseStablePluginRecord({ ...record, minimumAppVersion: '0.2.0' }), '0.1.0'),
        'app-update-required',
    );
    assert.equal(decidePluginUpdate('0.1.0', parseStablePluginRecord(record), '0.3.0'), 'newer-installed');
    assert.equal(decidePluginUpdate('0.1.0', parseStablePluginRecord(record), '0.2.0+private'), 'sync');
    assert.equal(decidePluginUpdate('0.1.0', parseStablePluginRecord(record), undefined), 'install');
    assert.equal(decidePluginUpdate('0.1.0', parseStablePluginRecord(record), '0.1.9'), 'update');
});

test('record accepts only stable immutable sources, no history or movable refs', () => {
    for (const value of [
        undefined,
        {},
        { ...record, schemaVersion: 2 },
        { ...record, version: '0.2.0-rc.1' },
        { ...record, version: '0.2.0+build' },
        { ...record, source: { ...record.source, sha: 'A'.repeat(40) } },
        { ...record, source: { ...record.source, ref: 'main' } },
        { ...record, history: [] },
        { ...record, source: { ...record.source, url: 'https://user:secret@example.invalid/a.git' } },
    ]) {
        assert.throws(() => parseStablePluginRecord(value), /stable plugin record/i);
    }
});

test('effective endpoint is one loopback HTTP MCP URL with no secret or suffix', () => {
    for (const value of ['http://127.0.0.1:27637/mcp', 'http://localhost:3333/mcp', 'http://[::1]:3333/mcp'])
        assert.equal(validateAppEndpoint(value), value);
    for (const value of [
        'https://127.0.0.1:2/mcp',
        'http://0.0.0.0:2/mcp',
        'http://127.0.0.2:2/mcp',
        'http://user:secret@localhost:2/mcp',
        'http://localhost:2/mcp?token=x',
        'http://localhost:2/mcp#x',
        'http://localhost:2/other',
        'http://localhost/mcp',
        'http://localhost:2/mcp/',
    ])
        assert.throws(() => validateAppEndpoint(value), /endpoint/i);
});
