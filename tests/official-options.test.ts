import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMcpArgs, suggestMcpArgs } from '../src/domains/official-options.ts';

test('official configuration accepts literal values, canonical aliases and explicit boolean overrides', () => {
    const options = parseMcpArgs([
        '--workspace',
        'C:/path with spaces & literal',
        '--workspace=D:/output',
        '--no-page-id-routing',
        '--experimental-memory=true',
        '--slim=false',
    ]);
    assert.deepEqual(options.get('filesystemRoot')?.values, ['C:/path with spaces & literal', 'D:/output']);
    assert.deepEqual(options.get('pageIdRouting')?.values, [false]);
    assert.deepEqual(options.get('memoryDebugging')?.values, [true]);
    assert.deepEqual(
        suggestMcpArgs(['--workspace=C:/output', '--no-experimental-vision', '--slim'], {
            experimentalVision: true,
            slim: false,
        }),
        ['--workspace=C:/output', '--experimentalVision=true', '--slim=false'],
    );
});

test('official args cannot replace endpoint ownership or smuggle config, flags or positional commands', () => {
    for (const args of [
        ['--browserUrl=http://127.0.0.1:1'],
        ['--browser-url=x'],
        ['-u', 'x'],
        ['--ws-endpoint=x'],
        ['--auto-connect'],
        ['--no-auto-connect'],
        ['--config=elsewhere'],
        ['--via-cli'],
        ['--headless'],
        ['--chrome-arg=--remote-debugging-port=9'],
        ['--workspace', '--config=x'],
        ['--', 'arbitrary'],
        ['--workspace=C:/work', ';'],
        ['--slim=true', '--slim=false'],
        ['--experimentalVision=maybe'],
        ['--mystery'],
    ])
        assert.throws(() => parseMcpArgs(args), Error, JSON.stringify(args));
});
