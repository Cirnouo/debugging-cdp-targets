import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { inspect } from 'node:util';
import type { ApplicationLaunch } from '../src/domains/launch-command.ts';
import {
    type ApplicationScreenshotFixture,
    type ApplicationScreenshotFixtureIO,
    applicationScreenshotGatewayEnvironment,
    expandApplicationScreenshotLaunch,
    parseApplicationScreenshotFixture,
    prepareApplicationScreenshotFixture,
} from './smoke/application-screenshot-fixture.ts';

const bytes = Buffer.from('synthetic executable bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const source = 'C:/Test/Apps & tools/应用/readest.exe';

function fixture(application: 'obsidian' | 'readest' = 'obsidian'): ApplicationScreenshotFixture {
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
                  executable: '{fixture}/native/readest.exe',
                  args: ['书籍 & $literal'],
                  cwd: '{fixture}/native',
                  env: {
                      WEBVIEW2_USER_DATA_FOLDER: '{fixture}/webview',
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
                corruptCopy && file.endsWith('/native/readest.exe') ? Buffer.from('corrupted') : Buffer.from(contents),
            );
        },
    };
    return { io, files, calls };
}

for (const application of ['obsidian', 'readest'] as const) {
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
            application === 'obsidian' ? source : 'C:/Test/Fresh & 数据/native/readest.exe',
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
