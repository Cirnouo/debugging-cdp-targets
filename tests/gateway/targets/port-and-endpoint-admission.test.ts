import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCdpIdentity } from '../../../src/gateway/targets/model/cdp-identity.ts';

test('CDP identity rejects foreign and exposed listeners', () => {
    const endpoint = {
        Browser: 'Chrome/153.0.0.0',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
    };
    const owned = [{ localAddress: '127.0.0.1', owningProcess: 42 }];
    assert.equal(
        validateCdpIdentity({ endpoint, port: 9222, listeners: owned, processIds: [42] }).browserProduct,
        endpoint.Browser,
    );
    assert.throws(() => validateCdpIdentity({ endpoint, port: 9222, listeners: owned, processIds: [43] }), /owner/i);
    assert.throws(
        () =>
            validateCdpIdentity({
                endpoint,
                port: 9222,
                listeners: [...owned, { localAddress: '0.0.0.0', owningProcess: 42 }],
                processIds: [42],
            }),
        /exposed/i,
    );
    assert.throws(
        () =>
            validateCdpIdentity({
                endpoint: { ...endpoint, webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/browser/test' },
                port: 9222,
                listeners: owned,
                processIds: [42],
            }),
        /port/i,
    );
});
