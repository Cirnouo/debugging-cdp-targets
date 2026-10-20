import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMcpArgs, suggestMcpArgs } from '../../../src/gateway/official/options.ts';

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

test('official 1.11 options accept file navigation control and canonical screencast rate alias', () => {
    const options = parseMcpArgs(['--no-file-navigations', '--screencast-fps=12']);
    assert.deepEqual(options.get('fileNavigations')?.values, [false]);
    assert.deepEqual(options.get('screencastFps')?.values, ['12']);
    assert.deepEqual(parseMcpArgs(['--experimental-screencast-fps=24']).get('screencastFps')?.values, ['24']);
    assert.throws(() => parseMcpArgs(['--screencast-fps=12', '--experimentalScreencastFps=24']), /Duplicate/);
});
