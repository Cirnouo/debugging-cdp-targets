import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as launch from '../src/domains/launch-command.ts';

test('structured launch preserves literal argument boundaries and recognizes a port supplied through environment', () => {
    assert.ok('resolveLaunchDefinition' in launch && typeof launch.resolveLaunchDefinition === 'function');
    assert.deepEqual(
        launch.resolveLaunchDefinition(
            {
                executable: 'C:/Apps/Reader.exe',
                args: ['a b', 'literal&value', ''],
                cwd: 'C:/Work',
                env: { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port={port}', LABEL: '中文' },
            },
            9226,
            {},
        ),
        {
            executablePath: 'C:/Apps/Reader.exe',
            arguments: ['a b', 'literal&value', ''],
            cwd: 'C:/Work',
            env: { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9226', LABEL: '中文' },
        },
    );
});

test('structured launch substitutes one selected port without adding a second port source', () => {
    assert.ok('resolveLaunchDefinition' in launch && typeof launch.resolveLaunchDefinition === 'function');
    assert.deepEqual(launch.resolveLaunchDefinition({ executable: '/opt/app', args: ['--port', '{port}'] }, 9333, {}), {
        executablePath: '/opt/app',
        arguments: ['--port', '9333'],
    });
    assert.deepEqual(launch.resolveLaunchDefinition({ executable: '/opt/app' }, 9333, {}), {
        executablePath: '/opt/app',
        arguments: ['--remote-debugging-port=9333'],
    });
});

test('launch validation rejects conflicting debugging sources and malformed executable, argv or environment', () => {
    assert.ok('resolveLaunchDefinition' in launch && typeof launch.resolveLaunchDefinition === 'function');
    for (const value of [
        { executable: '/opt/{port}/app' },
        { executable: '/opt/app', args: ['--remote-debugging-port=9444'] },
        { executable: '/opt/app', args: ['--remote-debugging-port={port}', '--remote-debugging-port={port}'] },
        { executable: '/opt/app', args: ['--remote-debugging-pipe'] },
        {
            executable: '/opt/app',
            args: ['--remote-debugging-port={port}'],
            env: { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9444' },
        },
        { executable: '/opt/app', args: ['bad\0argument'] },
        { executable: '/opt/app', env: { 'BAD=KEY': 'x' } },
        { executable: '/opt/app', env: { VALUE: 2 } },
        { executable: '/opt/app', unknown: true },
        { executable: '%MISSING%/app' },
    ]) {
        assert.throws(() => launch.resolveLaunchDefinition(value, 9333, {}));
    }
});

test('environment expansion validates path placeholders and malformed port sources before process creation', () => {
    assert.deepEqual(
        launch.resolveLaunchDefinition({ executable: '/app', args: ['--custom-port', '%PORT%'] }, 9333, {
            PORT: '{port}',
        }).arguments,
        ['--custom-port', '9333'],
    );
    for (const value of [
        { executable: '%APP%' },
        { executable: '/app', cwd: '%APP%' },
        { executable: '/app', args: ['--remote-debugging-port='] },
        { executable: '/app', args: ['--remote-debugging-port'] },
        { executable: '/app', env: { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' } },
        { executable: '/app', env: { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port' } },
    ])
        assert.throws(() => launch.resolveLaunchDefinition(value, 9333, { APP: '/{port}/app' }));
});

test('data directory references require an explicit binding and cannot select executable or cwd', () => {
    for (const value of [
        { executable: '/app', args: ['{dataDir}'] },
        { executable: '/app', env: { DATA: '{dataDir}' } },
        { executable: '/app', env: { '{dataDir}': 'literal' } },
        { executable: '/{dataDir}/app' },
        { executable: '/app', cwd: '{dataDir}' },
        { executable: '%APP%' },
    ]) {
        assert.throws(() => launch.resolveLaunchDefinition(value, 9333, { APP: '/{dataDir}/app' }));
    }
});

test('data directory bytes stay opaque after environment and port expansion', () => {
    const directory = `/data/中文 %NAME% \${NAME} {port} {dataDir} $& $' $\` "quoted"`;
    const result = launch.resolveLaunchDefinition(
        { executable: '/app', args: ['%BIND%', '--port={port}'], env: { DATA: `\${BIND}` } },
        9333,
        { BIND: '{dataDir}' },
        directory,
    );
    assert.deepEqual(result.arguments, [directory, '--port=9333']);
    assert.equal(result.env?.DATA, directory);
});

test('directory contents do not become debugging switches during binding', () => {
    const directory = '/data/ --remote-debugging-pipe --remote-debugging-port=9999';
    const result = launch.resolveLaunchDefinition(
        { executable: '/app', args: ['{dataDir}'], env: { DATA: '{dataDir}' } },
        9333,
        {},
        directory,
    );
    assert.deepEqual(result.arguments, [directory, '--remote-debugging-port=9333']);
    assert.equal(result.env?.DATA, directory);
});
