import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultAppConfiguration } from '../src/domains/app-configuration.ts';
import type { AppUiBridge, AppUiSnapshot } from '../src/domains/app-ui.ts';
import { AppManager } from '../src/interface/app-manager.ts';

function render(snapshot: AppUiSnapshot) {
    const bridge: AppUiBridge = {
        inspect: async () => snapshot,
        configure: async () => snapshot,
        manage: async () => snapshot,
        quit: async () => {},
        restart: async () => {},
    };
    return renderToStaticMarkup(createElement(AppManager, { bridge, initialSnapshot: snapshot }));
}

test('component-only rendering presents current ownership and unbounded clocks without a target-creation control', (context) => {
    context.mock.method(Date, 'now', () => 90_061_000);
    const configuration = defaultAppConfiguration();
    const html = render({
        phase: 'ready',
        configuration: { desired: configuration, effective: configuration, restartRequired: false },
        management: {
            registrations: [{ registrationId: '33333333-3333-4333-8333-333333333333', resources: 1, jobs: 0 }],
            connections: [
                {
                    connectionId: '11111111-1111-4111-8111-111111111111',
                    sessionId: '22222222-2222-4222-8222-222222222222',
                    registrationId: '33333333-3333-4333-8333-333333333333',
                    status: 'active',
                    targetGeneration: '44444444-4444-4444-8444-444444444444',
                    officialGeneration: '55555555-5555-4555-8555-555555555555',
                    establishedAt: 0,
                    lastRealOperationAt: 90_000_000,
                },
            ],
            operations: [],
            hosts: [],
        },
    });
    assert.match(html, /http:\/\/127\.0\.0\.1:27637\/mcp/);
    assert.match(html, /25:01:01/);
    assert.match(html, /00:01:01/);
    assert.match(html, /Owner 33333333/);
    assert.match(html, /Select connection 11111111/);
    assert.match(html, />Close selected<|>Close selected<\/button>/);
    assert.doesNotMatch(html, /<button[^>]*>Start/);
});

test('component-only startup and failed cleanup rendering never advertise a nonbound effective endpoint', () => {
    for (const phase of ['starting', 'failed', 'closing'] as const) {
        const configuration = defaultAppConfiguration();
        const html = render({
            phase,
            configuration: { desired: configuration, effective: configuration, restartRequired: false },
            message: 'Ownership is retained.',
        });
        assert.match(html, /Endpoint unavailable/);
        assert.doesNotMatch(html, /http:\/\/127\.0\.0\.1:27637\/mcp/);
        assert.match(html, /Ownership is retained/);
        if (phase === 'closing') assert.match(html, /Retry Quit/);
    }
});
