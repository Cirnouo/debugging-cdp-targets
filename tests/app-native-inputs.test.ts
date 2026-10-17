import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { verifyAppNativeInputs } from '../src/adapters/app-native.ts';
import { parseAppNativeEvidence } from '../src/domains/app-release.ts';

test('native input verification checks original package closure without loading the binary addon', async () => {
    const require = createRequire(import.meta.url);
    const entry = require.resolve('fs-native-extensions');
    assert.equal(require.cache[entry], undefined);
    const evidence = parseAppNativeEvidence(
        JSON.parse(await readFile(new URL('../tooling/app-native-release.json', import.meta.url), 'utf8')),
    );
    const verified = await verifyAppNativeInputs(evidence);
    assert.equal(verified.size, 6);
    assert.equal(verified.get('fs-native-extensions')?.files.size, 38);
    assert.equal(require.cache[entry], undefined);
});
