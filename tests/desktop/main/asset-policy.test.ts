import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appAssetPath } from '../../../src/desktop/main/asset-policy.ts';

test('the secure App scheme serves only fixed manager assets with exact authority and method', () => {
    assert.equal(appAssetPath('dct-app://manager/app.css', 'GET', 'dct-app://manager'), '/app.css');
    assert.equal(appAssetPath('dct-app://manager/', 'GET', undefined), '/');
    for (const url of [
        'file:///private',
        'https://manager/app.css',
        'dct-app://other/app.css',
        'dct-app://manager:42/app.css',
        'dct-app://user@manager/app.css',
        'dct-app://manager/app.css?q=1',
        'dct-app://manager/private',
        'not a URL',
    ])
        assert.equal(appAssetPath(url, 'GET', undefined), undefined);
    assert.equal(appAssetPath('dct-app://manager/', 'POST', undefined), undefined);
    assert.equal(appAssetPath('dct-app://manager/', 'GET', 'https://untrusted.invalid'), undefined);
});
