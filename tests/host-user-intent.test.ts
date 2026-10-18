import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHostUserIntent } from '../src/adapters/host-user-intent.ts';

test('Codex standard TOML forms expose only own intent and ignore unrelated edits', () => {
    const a = parseHostUserIntent(
        'codex',
        '[marketplaces.debugging-cdp-targets]\nsource_type="git"\nsource="https://example.invalid/repo.git"\n[plugins."debugging-cdp-targets@debugging-cdp-targets"]\nenabled=true\n[unrelated]\nsecret="private"\nbig=9007199254740993\n',
    );
    const b = parseHostUserIntent(
        'codex',
        'marketplaces."debugging-cdp-targets" = {source="https://example.invalid/repo.git", source_type="git"}\nplugins."debugging-cdp-targets@debugging-cdp-targets".enabled = true\n[unrelated]\nsecret="changed"\n',
    );
    assert.equal(a.snapshot, b.snapshot);
    assert.equal(a.pluginEnabled, true);
    assert.equal(a.readOnlyReason, undefined);
    assert.doesNotMatch(a.snapshot, /private|secret|unrelated|900719/);
});

test('Codex ref, unknown pin fields and explicit disablement cannot disappear behind CLI source output', () => {
    const source =
        '[marketplaces.debugging-cdp-targets]\nsource_type="git"\nsource="https://example.invalid/repo.git"\n';
    assert.equal(parseHostUserIntent('codex', `${source}ref="main"\n`).readOnlyReason, 'pinned-or-ambiguous');
    assert.equal(parseHostUserIntent('codex', `${source}pin="user"\n`).readOnlyReason, 'pinned-or-ambiguous');
    assert.equal(
        parseHostUserIntent('codex', '[plugins."debugging-cdp-targets@debugging-cdp-targets"]\nenabled=false\n')
            .pluginEnabled,
        false,
    );
    for (const text of [
        'bad toml',
        'x=1\nx=2\n',
        '__proto__.x=1\n',
        '[plugins."debugging-cdp-targets@debugging-cdp-targets"]\nenabled="true"\n',
    ])
        assert.throws(() => parseHostUserIntent('codex', text), /user-settings/);
});

test('Claude extracts the user source/ref/enablement without retaining unrelated inventory or tokens', () => {
    const intent = parseHostUserIntent(
        'claude',
        JSON.stringify({
            extraKnownMarketplaces: {
                'debugging-cdp-targets': {
                    source: { source: 'git', url: 'https://example.invalid/repo.git', ref: 'pinned' },
                    autoUpdate: false,
                },
            },
            enabledPlugins: { 'debugging-cdp-targets@debugging-cdp-targets': false },
            env: { TOKEN: 'private' },
        }),
    );
    assert.equal(intent.pluginEnabled, false);
    assert.equal(intent.readOnlyReason, 'pinned-or-ambiguous');
    assert.doesNotMatch(intent.snapshot, /TOKEN|private/);
    assert.throws(() => parseHostUserIntent('claude', '{bad'), /user-settings/);
});
