import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { inspect } from 'node:util';
import type { ApplicationLaunch } from '../src/domains/launch-command.ts';
import {
    type ApplicationScreenshotFixture,
    type ApplicationScreenshotFixtureIO,
    applicationScreenshotBrowserConfiguration,
    applicationScreenshotGatewayEnvironment,
    expandApplicationScreenshotLaunch,
    parseApplicationScreenshotFixture,
    prepareApplicationScreenshotFixture,
} from './smoke/application-screenshot-fixture.ts';

const bytes = Buffer.from('synthetic executable bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const source = 'C:/Test/Apps & tools/应用/readest.exe';

function fixture(application: 'obsidian' | 'readest' | 'tauri-fixture' = 'obsidian'): ApplicationScreenshotFixture {
    const baseline: ApplicationLaunch =
        application === 'obsidian'
            ? {
                  executable: source,
                  args: [
                      '--remote-debugging-port={port}',
                      '--user-data-dir={fixture}/profile',
                      '--enable-features=Other',
                      '--',
                      '笔记 & $literal',
                  ],
                  cwd: 'C:/Test/Working & files',
                  env: { HOST_DATA: '保留 & $literal "quotes"' },
              }
            : {
                  executable:
                      application === 'readest'
                          ? '{fixture}/native/readest.exe'
                          : '{fixture}/native/dct-tauri-screenshot-fixture.exe',
                  args: ['书籍 & $literal'],
                  cwd: '{fixture}/native',
                  env: {
                      WEBVIEW2_USER_DATA_FOLDER:
                          application === 'readest' ? '{fixture}/webview' : '{fixture}/webview2-profile',
                      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port={port} --enable-features=Other',
                      HOST_DATA: '保留 & $literal "quotes"',
                  },
              };
    const candidate = structuredClone(baseline);
    if (application === 'obsidian') {
        candidate.args = [
            '--remote-debugging-port={port}',
            '--user-data-dir={fixture}/profile',
            '--enable-features=Other,CDPScreenshotNewSurface',
            '--',
            '笔记 & $literal',
        ];
    } else {
        assert.ok(candidate.env);
        candidate.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =
            '--remote-debugging-port={port} --enable-features=Other,CDPScreenshotNewSurface';
    }
    return {
        application,
        source: { executable: source, sha256 },
        baseline,
        candidate,
        fixtureFiles: { 'synthetic/书籍 & file.txt': 'Synthetic fixture at {fixture}; no existing settings.' },
        page: { url: 'app://test/main', title: 'Synthetic main page', identity: 'synthetic-book' },
    };
}

function memoryIO(corruptCopy = false) {
    const calls: string[] = [];
    const files = new Map<string, Uint8Array>([[source, bytes]]);
    const io: ApplicationScreenshotFixtureIO = {
        async readFile(file) {
            calls.push(`read:${file}`);
            const value = files.get(file);
            assert.ok(value, 'Read only explicit source or newly written files.');
            return value;
        },
        async createFreshDirectory(parent) {
            calls.push(`fresh:${parent}`);
            return `${parent}/fresh-1`;
        },
        async writeFile(file, contents) {
            calls.push(`write:${file}`);
            assert.ok(!files.has(file), 'Never overwrite source or old fixture files.');
            files.set(
                file,
                corruptCopy && file.includes('/native/') ? Buffer.from('corrupted') : Buffer.from(contents),
            );
        },
    };
    return { io, files, calls };
}

for (const application of ['obsidian', 'readest', 'tauri-fixture'] as const) {
    test(`${application}: complete single-feature pair preserves literal host data`, () => {
        const input = fixture(application);
        const original = structuredClone(input);
        assert.deepEqual(parseApplicationScreenshotFixture(input), original);
        const expanded = expandApplicationScreenshotLaunch(input, 'candidate', 'C:/Test/Fresh & 数据');
        assert.equal(expanded.env?.HOST_DATA, '保留 & $literal "quotes"');
        assert.deepEqual(
            expanded.args?.slice(-1),
            application === 'obsidian' ? ['笔记 & $literal'] : ['书籍 & $literal'],
        );
        assert.equal(
            expanded.executable,
            application === 'obsidian'
                ? source
                : application === 'readest'
                  ? 'C:/Test/Fresh & 数据/native/readest.exe'
                  : 'C:/Test/Fresh & 数据/native/dct-tauri-screenshot-fixture.exe',
        );
        assert.deepEqual(input, original);
    });

    test(`${application}: refuses host argv/env/cwd/executable differences before any I/O`, async () => {
        const mutations: ((value: ApplicationScreenshotFixture) => void)[] = [
            (value) => {
                value.candidate.args?.push('unreviewed');
            },
            (value) => {
                value.candidate.cwd = 'C:/Test/Other';
            },
            (value) => {
                value.candidate.executable = 'C:/Test/Other.exe';
            },
            (value) => {
                value.candidate.env = { ...value.candidate.env, HOST_DATA: 'changed' };
            },
        ];
        for (const mutate of mutations) {
            const input = fixture(application);
            mutate(input);
            const { io, calls } = memoryIO();
            await assert.rejects(
                prepareApplicationScreenshotFixture(input, 'baseline', { parentDirectory: 'C:/Test/Evidence', io }),
            );
            assert.deepEqual(calls, []);
        }
    });
}

test('rejects enabled baselines, malformed lists and ambiguous effective feature switches', () => {
    for (const bad of [
        '--enable-features=CDPScreenshotNewSurface',
        '--disable-features=CDPScreenshotNewSurface',
        '--enable-features=*CDPScreenshotNewSurface',
        '--enable-features=CDPScreenshotNewSurface<Trial',
        '--enable-features=A<<Trial',
        '--Enable-features=Other',
        '/enable-features=Other',
        ' --enable-features=Other',
        '--single-argument',
        ' -- ',
        '--enable-features=非ASCII',
    ]) {
        const input = fixture();
        input.baseline.args?.unshift(bad);
        assert.throws(() => parseApplicationScreenshotFixture(input), bad);
    }
    for (const bad of [
        '--enable-features=Other,CDPScreenshotNewSurface,CDPScreenshotNewSurface',
        '--enable-features=Other,CDPScreenshotNewSurface:mode/value',
        '--disable-features=CDPScreenshotNewSurface',
    ]) {
        const input = fixture();
        input.candidate.args = ['--remote-debugging-port={port}', '--user-data-dir={fixture}/profile', bad];
        assert.throws(() => parseApplicationScreenshotFixture(input));
    }
});

test('feature addition must be before exact terminator while positional tail stays literal', () => {
    const input = fixture();
    input.baseline.args = [
        '--remote-debugging-port={port}',
        '--user-data-dir={fixture}/profile',
        '--',
        '--disable-features=CDPScreenshotNewSurface',
    ];
    input.candidate.args = [
        '--remote-debugging-port={port}',
        '--user-data-dir={fixture}/profile',
        '--enable-features=CDPScreenshotNewSurface',
        '--',
        '--disable-features=CDPScreenshotNewSurface',
    ];
    assert.doesNotThrow(() => parseApplicationScreenshotFixture(input));
    input.candidate.args = [...input.baseline.args, '--enable-features=CDPScreenshotNewSurface'];
    assert.throws(() => parseApplicationScreenshotFixture(input));
});

test('Readest refuses opaque browser env codecs, profile/port aliases and related inherited conflicts', () => {
    for (const bad of [
        '"--remote-debugging-port={port}" --enable-features=Other',
        '--remote-debugging-port={port}; echo bad',
        '--remote-debugging-port={port}  --enable-features=Other',
        '--remote-debugging-port={port}\t--enable-features=Other',
        '--remote-debugging-port={port} --single-argument',
        '--remote-debugging-port={port} --user-data-dir={fixture}/another',
        '--remote-debugging-port={port} --enable-features=Other --remote-debugging-port=9222',
    ]) {
        const input = fixture('readest');
        assert.ok(input.baseline.env);
        input.baseline.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = bad;
        assert.throws(() => parseApplicationScreenshotFixture(input), bad);
    }
    for (const key of [
        'webview2_user_data_folder',
        'WEBVIEW2_BROWSER_EXECUTABLE_FOLDER',
        'WEBVIEW2_PIPE_FOR_SCRIPT_DEBUGGER',
    ]) {
        const input = fixture('readest');
        input.baseline.env = { ...input.baseline.env, [key]: '{fixture}/other' };
        input.candidate.env = { ...input.candidate.env, [key]: '{fixture}/other' };
        assert.throws(() => parseApplicationScreenshotFixture(input));
        assert.throws(() => parseApplicationScreenshotFixture(fixture('readest'), { [key]: 'inherited-conflict' }));
    }
    const input = fixture('readest');
    input.baseline.env = { ...input.baseline.env, host_data: 'alias' };
    assert.throws(() => parseApplicationScreenshotFixture(input));
});

test('requires one canonical explicit port and a confined fresh application profile', () => {
    for (const args of [
        ['--user-data-dir={fixture}/profile'],
        ['--remote-debugging-port={port}', '--user-data-dir=C:/Test/Old'],
        ['--remote-debugging-port={port}', '--user-data-dir={fixture}/profile', '--user-data-dir={fixture}/two'],
        ['--remote-debugging-port', '{port}', '--user-data-dir={fixture}/profile'],
        ['--remote-debugging-port=9222', '--user-data-dir={fixture}/profile'],
        ['--remote-debugging-port={port}', '--remote-debugging-pipe', '--user-data-dir={fixture}/profile'],
        ['--remote-debugging-port={port}', '--User-data-dir={fixture}/profile'],
    ]) {
        const input = fixture();
        input.baseline.args = args;
        input.candidate.args = [...args, '--enable-features=CDPScreenshotNewSurface'];
        assert.throws(() => parseApplicationScreenshotFixture(input));
    }
});

test('refuses directory traversal, environment expansion, executable substitution and file aliases', () => {
    for (const bad of [
        '../old.txt',
        '/absolute.txt',
        'C:/Test/absolute.txt',
        'C:relative.txt',
        'nested/../old',
        'nested\\..\\old',
        'file:stream',
        '%ROOT%/file',
        '$' + '{ROOT}/file',
        'trailing./file',
    ]) {
        const input = fixture();
        input.fixtureFiles = { [bad]: 'synthetic' };
        assert.throws(() => parseApplicationScreenshotFixture(input), bad);
    }
    const mutations: ((value: ApplicationScreenshotFixture) => void)[] = [
        (value) => {
            value.baseline.executable = value.candidate.executable = '{fixture}/other.exe';
        },
        (value) => {
            value.baseline.cwd = value.candidate.cwd = '{fixture}/../escape';
        },
        (value) => {
            value.baseline.args = ['--remote-debugging-port={port}', '--user-data-dir={fixture}/%ROOT%'];
        },
        (value) => {
            value.fixtureFiles = { 'synthetic/A.txt': 'one', 'synthetic/a.txt': 'two' };
        },
        (value) => {
            value.source.sha256 = 'not-a-hash';
        },
        (value) => {
            value.source.executable = '{fixture}/readest.exe';
        },
        (value) => {
            value.page.title = '';
        },
    ];
    for (const mutate of mutations) {
        const input = fixture();
        mutate(input);
        assert.throws(() => parseApplicationScreenshotFixture(input));
    }
    const controlledCopy = fixture('readest');
    controlledCopy.fixtureFiles = { 'native/readest.exe': 'overwrite binary' };
    assert.throws(() => parseApplicationScreenshotFixture(controlledCopy));
    assert.throws(() => expandApplicationScreenshotLaunch(fixture(), 'baseline', 'C:/Test/%ROOT%'));
});

test('verified source bytes create a new Readest copy and synthetic files without shell interpretation', async () => {
    const { io, files, calls } = memoryIO();
    const result = await prepareApplicationScreenshotFixture(fixture('readest'), 'candidate', {
        parentDirectory: 'C:/Test/Evidence & 数据',
        io,
    });
    assert.equal(result.directory, 'C:/Test/Evidence & 数据/fresh-1');
    assert.equal(result.sourceSha256, sha256);
    assert.equal(result.copySha256, sha256);
    assert.equal(result.launch.executable, 'C:/Test/Evidence & 数据/fresh-1/native/readest.exe');
    assert.equal(result.launch.env?.WEBVIEW2_USER_DATA_FOLDER, 'C:/Test/Evidence & 数据/fresh-1/webview');
    assert.equal(
        result.launch.env?.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
        '--remote-debugging-port={port} --enable-features=Other,CDPScreenshotNewSurface',
    );
    assert.equal(
        Buffer.from(files.get('C:/Test/Evidence & 数据/fresh-1/synthetic/书籍 & file.txt') ?? []).toString(),
        'Synthetic fixture at C:/Test/Evidence & 数据/fresh-1; no existing settings.',
    );
    assert.deepEqual(files.get(source), bytes);
    assert.equal(calls[0], `read:${source}`);
});

test('source mismatch prevents directory acquisition; copy mismatch prevents fixture text writes', async () => {
    const input = fixture('readest');
    input.source.sha256 = '0'.repeat(64);
    const sourceMismatch = memoryIO();
    await assert.rejects(
        prepareApplicationScreenshotFixture(input, 'baseline', {
            parentDirectory: 'C:/Test/Evidence',
            io: sourceMismatch.io,
        }),
        /hash/i,
    );
    assert.deepEqual(sourceMismatch.calls, [`read:${source}`]);
    const copyMismatch = memoryIO(true);
    await assert.rejects(
        prepareApplicationScreenshotFixture(fixture('readest'), 'baseline', {
            parentDirectory: 'C:/Test/Evidence',
            io: copyMismatch.io,
        }),
        /hash/i,
    );
    assert.ok(!copyMismatch.calls.some((call) => call.includes('synthetic/')));
});

test('fresh-directory boundary cannot return an old parent or escaped directory', async () => {
    for (const directory of [
        'C:/Test/Evidence',
        'C:/Test/Elsewhere/new',
        'C:/Test/Evidence/../old',
        'C:/Test/Evidence/%ROOT%',
    ]) {
        const state = memoryIO();
        state.io.createFreshDirectory = async () => directory;
        await assert.rejects(
            prepareApplicationScreenshotFixture(fixture('readest'), 'baseline', {
                parentDirectory: 'C:/Test/Evidence',
                io: state.io,
            }),
        );
        assert.ok(!state.calls.some((call) => call.startsWith('write:')));
    }
});

test('controlled gateway environment keeps OS execution bytes, removes WebView2 inheritance and rejects aliases', () => {
    const input = {
        Path: 'C:/Test/工具 & bin',
        SystemRoot: 'C:/Test/Windows',
        TEMP: 'C:/Test/Temp',
        SECRET: 'unprinted',
        webview2_user_data_folder: 'old',
        WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: 'old',
        EMPTY: undefined,
    };
    assert.deepEqual(applicationScreenshotGatewayEnvironment(input), {
        PATH: 'C:/Test/工具 & bin',
        SYSTEMROOT: 'C:/Test/Windows',
        TEMP: 'C:/Test/Temp',
        SECRET: 'unprinted',
    });
    assert.equal(input.webview2_user_data_folder, 'old');
    assert.throws(() => applicationScreenshotGatewayEnvironment({ Path: 'one', PATH: 'two' }));
});

test('known synthetic main-page identity allows an unknown runtime title', () => {
    const input = fixture('readest');
    delete input.page.title;
    assert.deepEqual(parseApplicationScreenshotFixture(input).page, {
        url: 'app://test/main',
        identity: 'synthetic-book',
    });
    delete input.page.identity;
    assert.throws(() => parseApplicationScreenshotFixture(input));
});

test('Readest feature comparison honors the exact browser terminator', () => {
    const input = fixture('readest');
    assert.ok(input.baseline.env && input.candidate.env);
    input.baseline.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =
        '--remote-debugging-port={port} -- --disable-features=CDPScreenshotNewSurface';
    input.candidate.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =
        '--remote-debugging-port={port} --enable-features=CDPScreenshotNewSurface -- --disable-features=CDPScreenshotNewSurface';
    assert.doesNotThrow(() => parseApplicationScreenshotFixture(input));
});

test('Windows whitespace aliases cannot hide extra browser port/profile carriers', () => {
    for (const bad of ['\u0085--remote-debugging-port=9999', '\u0085--user-data-dir=C:/Test/Old']) {
        const input = fixture();
        input.baseline.args?.unshift(bad);
        input.candidate.args?.unshift(bad);
        assert.throws(() => parseApplicationScreenshotFixture(input));
    }
});

test('file-directory collisions reject the full pair before I/O', async () => {
    const input = fixture('readest');
    input.fixtureFiles = { 'synthetic/file': 'one', 'synthetic/file/nested': 'two' };
    const { io, calls } = memoryIO();
    await assert.rejects(
        prepareApplicationScreenshotFixture(input, 'baseline', { parentDirectory: 'C:/Test/Evidence', io }),
    );
    assert.deepEqual(calls, []);
});

test('a bare feature can be inserted into an existing canonical list without changing host bytes', () => {
    const input = fixture();
    assert.ok(input.candidate.args);
    input.candidate.args[2] = '--enable-features=CDPScreenshotNewSurface,Other';
    assert.doesNotThrow(() => parseApplicationScreenshotFixture(input));
});

test('launch-pair errors do not embed configured host data in diagnostic objects', () => {
    const input = fixture();
    input.candidate.env = { ...input.candidate.env, HOST_DATA: 'private-config-sentinel' };
    assert.throws(
        () => parseApplicationScreenshotFixture(input),
        (error: unknown) => !inspect(error).includes('private-config-sentinel'),
    );
});

test('malformed empty feature-list entries cannot enter either arm', () => {
    for (const value of ['Other,,Another', ',Other', 'Other,']) {
        const input = fixture();
        assert.ok(input.baseline.args && input.candidate.args);
        input.baseline.args[2] = `--enable-features=${value}`;
        input.candidate.args[2] = `--enable-features=${value},CDPScreenshotNewSurface`;
        assert.throws(() => parseApplicationScreenshotFixture(input));
    }
});

test('synthetic text rejects invalid UTF8 and substitution/traversal escapes before I/O', async () => {
    for (const contents of ['\ud800', 'profile=%ROOT%/old', 'profile=$' + '{ROOT}/old', 'profile={fixture}/../old']) {
        const input = fixture('readest');
        input.fixtureFiles = { 'synthetic/config.txt': contents };
        const { io, calls } = memoryIO();
        await assert.rejects(
            prepareApplicationScreenshotFixture(input, 'candidate', { parentDirectory: 'C:/Test/Evidence', io }),
        );
        assert.deepEqual(calls, []);
    }
});

test('page selection requires a URL and nonblank known title or synthetic identity', () => {
    for (const page of [
        { url: 'invalid-url', title: 'Main' },
        { url: 'app://test/main', title: ' ' },
        { url: 'app://test/main', identity: ' ' },
    ]) {
        const input = fixture();
        input.page = page;
        assert.throws(() => parseApplicationScreenshotFixture(input));
    }
});

test('Readest source-executable pairs cannot bypass fresh-copy preparation', async () => {
    const input = fixture('readest');
    input.baseline.executable = input.candidate.executable = input.source.executable;
    input.baseline.cwd = input.candidate.cwd = 'C:/Test/Apps & tools/应用';
    assert.throws(() => parseApplicationScreenshotFixture(input));
    for (const arm of ['baseline', 'candidate'] as const) {
        const { io, calls } = memoryIO();
        await assert.rejects(
            prepareApplicationScreenshotFixture(input, arm, { parentDirectory: 'C:/Test/Evidence', io }),
        );
        assert.deepEqual(calls, []);
    }
});

function addBrowserOptions(input: ApplicationScreenshotFixture, options: string[]) {
    for (const arm of ['baseline', 'candidate'] as const) {
        if (input.application === 'obsidian') input[arm].args?.unshift(...options);
        else {
            const env = input[arm].env;
            assert.ok(env);
            env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `${options.join(' ')} ${env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS}`;
        }
    }
}

for (const application of ['obsidian', 'readest'] as const) {
    test(`${application}: unsafe, duplicate or ambiguous addresses reject the full pair before I/O`, async () => {
        // 192.0.2.10 is a fictional documentation address, never a host lookup.
        for (const options of [
            ['--remote-debugging-address=0.0.0.0'],
            ['--remote-debugging-address=192.0.2.10'],
            ['--remote-debugging-address=127.0.0.1', '--remote-debugging-address=::1'],
            ['--remote-debugging-address=127.0.0.1', '--remote-debugging-address=127.0.0.1'],
            ['--Remote-debugging-address=127.0.0.1'],
            ['/remote-debugging-address=127.0.0.1'],
            ['-remote-debugging-address=127.0.0.1'],
            ['--remote-debugging-address:127.0.0.1'],
            ['--remote-debugging-address', '127.0.0.1'],
            [' --remote-debugging-address=127.0.0.1'],
            ['\u0085--remote-debugging-address=127.0.0.1'],
        ]) {
            const input = fixture(application);
            addBrowserOptions(input, options);
            assert.throws(() => parseApplicationScreenshotFixture(input));
            const { io, calls } = memoryIO();
            await assert.rejects(
                prepareApplicationScreenshotFixture(input, 'baseline', { parentDirectory: 'C:/Test/Evidence', io }),
            );
            assert.deepEqual(calls, []);
        }
    });

    test(`${application}: optional canonical loopback address and omission preserve browser bytes`, () => {
        const omitted = fixture(application);
        assert.deepEqual(parseApplicationScreenshotFixture(omitted), omitted);
        for (const address of ['127.0.0.1', '::1']) {
            const input = fixture(application);
            addBrowserOptions(input, [`--remote-debugging-address=${address}`]);
            assert.deepEqual(parseApplicationScreenshotFixture(input), input);
        }
    });
}

test('Unicode uppercase aliases cannot reintroduce WebView2 inheritance', async () => {
    for (const key of ['webvıew2_user_data_folder', 'webvıew2_additional_browser_arguments']) {
        const inherited = { Path: 'C:/Test/Unicode & bin', [key]: 'synthetic-old' };
        assert.deepEqual(applicationScreenshotGatewayEnvironment(inherited), { PATH: 'C:/Test/Unicode & bin' });
        assert.equal(inherited[key], 'synthetic-old');
        assert.throws(() => parseApplicationScreenshotFixture(fixture('readest'), inherited));
        const { io, calls } = memoryIO();
        await assert.rejects(
            prepareApplicationScreenshotFixture(fixture('readest'), 'baseline', {
                parentDirectory: 'C:/Test/Evidence',
                inheritedEnvironment: inherited,
                io,
            }),
        );
        assert.deepEqual(calls, []);
    }
    const input = fixture('readest');
    for (const arm of ['baseline', 'candidate'] as const) {
        input[arm].env = { ...input[arm].env, webvıew2_browser_executable_folder: 'synthetic-old' };
    }
    assert.throws(() => parseApplicationScreenshotFixture(input));
});

test('JSON own __proto__ synthetic file is preserved and written exactly once inside the fixture', async () => {
    const fixtureFiles: unknown = JSON.parse('{"__proto__":"synthetic"}');
    const input = { ...fixture(), fixtureFiles };
    const parsed = parseApplicationScreenshotFixture(input);
    assert.ok(Object.hasOwn(parsed.fixtureFiles, '__proto__'));
    assert.deepEqual(Object.entries(parsed.fixtureFiles), [['__proto__', 'synthetic']]);
    const { io, calls, files } = memoryIO();
    await prepareApplicationScreenshotFixture(input, 'baseline', { parentDirectory: 'C:/Test/Evidence', io });
    assert.deepEqual(
        calls.filter((call) => call.startsWith('write:')),
        ['write:C:/Test/Evidence/fresh-1/__proto__'],
    );
    assert.equal(Buffer.from(files.get('C:/Test/Evidence/fresh-1/__proto__') ?? []).toString(), 'synthetic');
});

test('invalid Windows file components fail before source reads or any fixture writes', async () => {
    for (const bad of [
        'bad?.txt',
        'bad\u0001.txt',
        'bad\u001f.txt',
        'bad*.txt',
        'bad<.txt',
        'bad>.txt',
        'bad".txt',
        'bad|.txt',
        'nested/bad?.txt',
    ]) {
        const input = fixture('readest');
        input.fixtureFiles = { 'synthetic/first.txt': 'valid first entry', [bad]: 'invalid later entry' };
        assert.throws(() => parseApplicationScreenshotFixture(input));
        const { io, calls } = memoryIO();
        await assert.rejects(
            prepareApplicationScreenshotFixture(input, 'candidate', { parentDirectory: 'C:/Test/Evidence', io }),
        );
        assert.deepEqual(calls, []);
    }
});

test('invalid port refusal omits raw configured data from the diagnostic object before I/O', async () => {
    const input = fixture();
    assert.ok(input.baseline.args && input.candidate.args);
    input.baseline.args[0] = input.candidate.args[0] = '--remote-debugging-port=private-port-sentinel';
    assert.throws(
        () => parseApplicationScreenshotFixture(input),
        (error: unknown) => !inspect(error).includes('private-port-sentinel'),
    );
    const { io, calls } = memoryIO();
    await assert.rejects(
        prepareApplicationScreenshotFixture(input, 'baseline', { parentDirectory: 'C:/Test/Evidence', io }),
        (error: unknown) => !inspect(error).includes('private-port-sentinel'),
    );
    assert.deepEqual(calls, []);
});

test('Tauri preparation hashes the controlled copy before synthetic writes and preserves the source', async () => {
    const input = fixture('tauri-fixture');
    const { io, calls, files } = memoryIO();
    const prepared = await prepareApplicationScreenshotFixture(input, 'candidate', {
        parentDirectory: 'C:/Test/Evidence & 数据',
        io,
    });
    assert.equal(prepared.sourceSha256, sha256);
    assert.equal(prepared.copySha256, sha256);
    assert.equal(prepared.launch.executable, 'C:/Test/Evidence & 数据/fresh-1/native/dct-tauri-screenshot-fixture.exe');
    assert.equal(prepared.launch.cwd, 'C:/Test/Evidence & 数据/fresh-1/native');
    assert.equal(prepared.launch.env?.WEBVIEW2_USER_DATA_FOLDER, 'C:/Test/Evidence & 数据/fresh-1/webview2-profile');
    assert.deepEqual(calls, [
        `read:${source}`,
        'fresh:C:/Test/Evidence & 数据',
        'write:C:/Test/Evidence & 数据/fresh-1/native/dct-tauri-screenshot-fixture.exe',
        'read:C:/Test/Evidence & 数据/fresh-1/native/dct-tauri-screenshot-fixture.exe',
        'write:C:/Test/Evidence & 数据/fresh-1/synthetic/书籍 & file.txt',
    ]);
    assert.deepEqual(files.get(source), bytes);
});

test('Tauri source and copy mismatch stop at their respective acquisition boundaries', async () => {
    const input = fixture('tauri-fixture');
    input.source.sha256 = '0'.repeat(64);
    const sourceMismatch = memoryIO();
    await assert.rejects(
        prepareApplicationScreenshotFixture(input, 'baseline', {
            parentDirectory: 'C:/Test/Evidence',
            io: sourceMismatch.io,
        }),
        /hash/i,
    );
    assert.deepEqual(sourceMismatch.calls, [`read:${source}`]);
    const copyMismatch = memoryIO(true);
    await assert.rejects(
        prepareApplicationScreenshotFixture(fixture('tauri-fixture'), 'candidate', {
            parentDirectory: 'C:/Test/Evidence',
            io: copyMismatch.io,
        }),
        /hash/i,
    );
    assert.deepEqual(copyMismatch.calls, [
        `read:${source}`,
        'fresh:C:/Test/Evidence',
        'write:C:/Test/Evidence/fresh-1/native/dct-tauri-screenshot-fixture.exe',
        'read:C:/Test/Evidence/fresh-1/native/dct-tauri-screenshot-fixture.exe',
    ]);
});

test('Tauri requires its exact fresh copied executable, native cwd and WebView2 profile before I/O', async () => {
    const mutations: ((value: ApplicationScreenshotFixture) => void)[] = [
        (value) => {
            value.baseline.executable = value.candidate.executable = source;
        },
        (value) => {
            value.baseline.executable = value.candidate.executable = '{fixture}/native/readest.exe';
        },
        (value) => {
            value.baseline.cwd = value.candidate.cwd = 'C:/Test/Working';
        },
        (value) => {
            delete value.baseline.cwd;
            delete value.candidate.cwd;
        },
        ...['C:/Test/Old', '{fixture}/another', '{fixture}/webview2-profile/../old'].map(
            (profile) => (value: ApplicationScreenshotFixture) => {
                for (const arm of ['baseline', 'candidate'] as const) {
                    assert.ok(value[arm].env);
                    value[arm].env.WEBVIEW2_USER_DATA_FOLDER = profile;
                }
            },
        ),
        (value) => {
            value.fixtureFiles = { 'Native/other.txt': 'overwrite native directory' };
        },
        (value) => {
            value.fixtureFiles = { native: 'overwrite native directory' };
        },
    ];
    for (const mutate of mutations) {
        const input = fixture('tauri-fixture');
        mutate(input);
        for (const arm of ['baseline', 'candidate'] as const) {
            const { io, calls } = memoryIO();
            await assert.rejects(
                prepareApplicationScreenshotFixture(input, arm, { parentDirectory: 'C:/Test/Evidence', io }),
            );
            assert.deepEqual(calls, []);
        }
    }
});

test('Tauri rejects malformed, alternate and inherited WebView2 carriers before I/O', async () => {
    for (const carrier of [
        '--remote-debugging-port={port} --remote-debugging-port=9222',
        '--remote-debugging-port=9222',
        '--remote-debugging-port={port} --remote-debugging-pipe',
        '--remote-debugging-port={port} --remote-debugging-address=0.0.0.0',
        '--remote-debugging-port={port} --remote-debugging-address=127.0.0.1 --remote-debugging-address=::1',
        '--Remote-debugging-port={port}',
        '--remote-debugging-port {port}',
        '--remote-debugging-port={port} --user-data-dir={fixture}/webview2-profile',
        '--remote-debugging-port={port} --single-argument',
        '--remote-debugging-port={port};echo-bad',
        '"--remote-debugging-port={port}"',
        '--remote-debugging-port={port}  --enable-features=Other',
        '--remote-debugging-port={port}\t--enable-features=Other',
    ]) {
        const input = fixture('tauri-fixture');
        assert.ok(input.baseline.env);
        input.baseline.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = carrier;
        const { io, calls } = memoryIO();
        await assert.rejects(
            prepareApplicationScreenshotFixture(input, 'baseline', { parentDirectory: 'C:/Test/Evidence', io }),
        );
        assert.deepEqual(calls, []);
    }
    for (const key of [
        'webview2_user_data_folder',
        'webvıew2_user_data_folder',
        'webview2_additional_browser_arguments',
        'WEBVIEW2_BROWSER_EXECUTABLE_FOLDER',
        'WEBVIEW2_PIPE_FOR_SCRIPT_DEBUGGER',
    ]) {
        const input = fixture('tauri-fixture');
        for (const arm of ['baseline', 'candidate'] as const) {
            input[arm].env = { ...input[arm].env, [key]: 'synthetic-old' };
        }
        for (const [value, inheritedEnvironment] of [
            [input, {}],
            [fixture('tauri-fixture'), { [key]: 'synthetic-old' }],
        ] as const) {
            const { io, calls } = memoryIO();
            await assert.rejects(
                prepareApplicationScreenshotFixture(value, 'candidate', {
                    parentDirectory: 'C:/Test/Evidence',
                    inheritedEnvironment,
                    io,
                }),
            );
            assert.deepEqual(calls, []);
        }
    }
});

test('Tauri permits only one bare enabled feature as the complete launch-pair difference', () => {
    const input = fixture('tauri-fixture');
    assert.ok(input.baseline.env && input.candidate.env);
    input.baseline.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port={port}';
    input.candidate.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =
        '--remote-debugging-port={port} --enable-features=CDPScreenshotNewSurface';
    assert.deepEqual(parseApplicationScreenshotFixture(input), input);
    for (const feature of [
        'CDPScreenshotNewSurface,CDPScreenshotNewSurface',
        '*CDPScreenshotNewSurface',
        'CDPScreenshotNewSurface:parameter/value',
        'CDPScreenshotNewSurface<trial',
        'CDPScreenshotNewSurface.group',
        'OtherCDPScreenshotNewSurface',
        'CDPScreenshotNewSurface,Other',
    ]) {
        const malformed = structuredClone(input);
        assert.ok(malformed.candidate.env);
        malformed.candidate.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port={port} --enable-features=${feature}`;
        assert.throws(() => parseApplicationScreenshotFixture(malformed));
    }
    for (const featureSwitch of [
        '--enable-features=CDPScreenshotNewSurface',
        '--disable-features=CDPScreenshotNewSurface',
        '--disable-features=*CDPScreenshotNewSurface',
    ]) {
        const malformed = structuredClone(input);
        assert.ok(malformed.baseline.env);
        malformed.baseline.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS += ` ${featureSwitch}`;
        assert.throws(() => parseApplicationScreenshotFixture(malformed));
    }
    const argvCarrier = structuredClone(input);
    argvCarrier.candidate.args?.push('--enable-features=CDPScreenshotNewSurface');
    assert.throws(() => parseApplicationScreenshotFixture(argvCarrier));
});

test('Tauri fresh directory refusal prevents controlled native copy and profile expansion outside the parent', async () => {
    for (const directory of ['C:/Test/Evidence', 'C:/Test/Elsewhere/new', 'C:/Test/Evidence/../old']) {
        const state = memoryIO();
        state.io.createFreshDirectory = async () => directory;
        await assert.rejects(
            prepareApplicationScreenshotFixture(fixture('tauri-fixture'), 'baseline', {
                parentDirectory: 'C:/Test/Evidence',
                io: state.io,
            }),
        );
        assert.deepEqual(state.calls, [`read:${source}`]);
    }
});

test('explicit carrier helper reports only effective bare feature membership from the selected application', () => {
    for (const application of ['obsidian', 'readest', 'tauri-fixture'] as const) {
        const input = fixture(application);
        for (const arm of ['baseline', 'candidate'] as const) {
            if (application === 'obsidian') input[arm].args?.push('--enable-features=CDPScreenshotNewSurface');
            else {
                assert.ok(input[arm].env);
                input[arm].env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS +=
                    ' -- --disable-features=CDPScreenshotNewSurface';
                input[arm].args = ['--', '--enable-features=CDPScreenshotNewSurface'];
            }
        }
        assert.doesNotThrow(() => parseApplicationScreenshotFixture(input));
        assert.deepEqual(applicationScreenshotBrowserConfiguration(application, input.baseline), {
            browserArguments:
                application === 'obsidian'
                    ? ['--remote-debugging-port={port}', '--user-data-dir={fixture}/profile', '--enable-features=Other']
                    : ['--remote-debugging-port={port}', '--enable-features=Other'],
            screenshotFeatureEnabled: false,
        });
        assert.equal(
            applicationScreenshotBrowserConfiguration(application, input.candidate).screenshotFeatureEnabled,
            true,
        );
        const substring = structuredClone(input.baseline);
        if (application === 'obsidian') {
            assert.ok(substring.args);
            substring.args[2] = '--enable-features=OtherCDPScreenshotNewSurface';
        } else {
            assert.ok(substring.env);
            substring.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =
                '--remote-debugging-port={port} --enable-features=OtherCDPScreenshotNewSurface';
        }
        assert.equal(applicationScreenshotBrowserConfiguration(application, substring).screenshotFeatureEnabled, false);
    }
    assert.throws(() =>
        applicationScreenshotBrowserConfiguration('tauri-fixture', {
            executable: 'C:/Test/Fixture.exe',
            args: ['--remote-debugging-port={port}', '--enable-features=CDPScreenshotNewSurface'],
        }),
    );
});
