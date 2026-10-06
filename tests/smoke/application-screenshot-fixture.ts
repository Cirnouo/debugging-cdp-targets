import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { withChromeScreenshotFeature } from '../../src/domains/chromium-features.ts';
import { type ApplicationLaunch, parseApplicationLaunch } from '../../src/domains/launch-command.ts';
import { isRecord } from '../../src/shared/errors.ts';

export interface ApplicationScreenshotFixture {
    application: 'obsidian' | 'readest';
    source: { executable: string; sha256: string };
    baseline: ApplicationLaunch;
    candidate: ApplicationLaunch;
    fixtureFiles: Record<string, string>;
    page: { url: string; title?: string; identity?: string };
}

export interface ApplicationScreenshotFixtureIO {
    readFile(file: string): Promise<Uint8Array>;
    createFreshDirectory(parent: string): Promise<string>;
    writeFile(file: string, contents: Uint8Array): Promise<void>;
}

export interface PreparedApplicationScreenshotFixture {
    fixture: ApplicationScreenshotFixture;
    directory: string;
    launch: ApplicationLaunch;
    sourceSha256: string;
    copySha256?: string;
}

const browserArguments = 'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS';
const profileEnvironment = 'WEBVIEW2_USER_DATA_FOLDER';
const portArgument = '--remote-debugging-port={port}';
const controlledExecutable = '{fixture}/native/readest.exe';
const environmentToken = /%[A-Za-z_][A-Za-z\d_]*%|\$\{[A-Za-z_][A-Za-z\d_]*\}/;

function text(value: unknown): asserts value is string {
    assert.ok(typeof value === 'string' && value.trim().length > 0 && !value.includes('\0'), 'Nonempty text required.');
}

function fields(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
    assert.ok(isRecord(value) && Object.keys(value).every((key) => allowed.includes(key)), 'Unknown fixture field.');
}

function safeRelative(file: string) {
    assert.ok(
        file.length > 0 &&
            !file.includes('\0') &&
            !environmentToken.test(file) &&
            !file.includes('{') &&
            !file.includes('}') &&
            !path.posix.isAbsolute(file) &&
            !path.win32.isAbsolute(file) &&
            !file.includes(':'),
        'Fixture path escapes its new directory.',
    );
    const segments = file.split(/[\\/]/);
    assert.ok(
        segments.every(
            (segment) =>
                segment.length > 0 &&
                segment !== '.' &&
                segment !== '..' &&
                !/[. ]$/.test(segment) &&
                !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
        ),
        'Ambiguous fixture path component.',
    );
}

function safeLiteral(value: string) {
    assert.ok(!environmentToken.test(value), 'Environment substitutions are outside this fixture contract.');
    assert.ok(!value.split(/[\\/]/).includes('..'), 'Fixture path traversal is forbidden.');
}

function fixturePath(value: string) {
    assert.ok(value.startsWith('{fixture}/'), 'A confined fresh fixture path is required.');
    safeRelative(value.slice('{fixture}/'.length));
}

function absolutePath(value: string) {
    text(value);
    safeLiteral(value);
    assert.ok(path.posix.isAbsolute(value) || path.win32.isAbsolute(value), 'Explicit absolute path required.');
    assert.ok(!/[{}]/.test(value), 'Absolute paths cannot contain placeholders.');
}

function environmentKeys(environment: Record<string, string | undefined>) {
    const names = new Set<string>();
    for (const [name, value] of Object.entries(environment)) {
        assert.ok(name && !/[=\0]/.test(name), 'Invalid environment name.');
        const canonical = name.toUpperCase();
        assert.ok(!names.has(canonical), 'Windows environment aliases conflict.');
        names.add(canonical);
        assert.ok(
            value === undefined || (typeof value === 'string' && !value.includes('\0')),
            'Invalid environment value.',
        );
    }
}

function effective(args: readonly string[]) {
    const end = args.indexOf('--');
    return args.slice(0, end < 0 ? args.length : end);
}

function browserSwitches(value: string) {
    // This is an experiment input codec, not a general WebView2 command parser.
    assert.ok(/^--[^ ]*(?: --[^ ]*)*$/.test(value), 'Browser arguments must be simple ASCII space-separated switches.');
    assert.ok(!/[^\x21-\x7e ]|["'`$;&|<>\\()%]/.test(value), 'Opaque or shell browser argument syntax is forbidden.');
    return value.split(' ');
}

function validateBrowserOptions(args: readonly string[], application: 'obsidian' | 'readest') {
    withChromeScreenshotFeature(args);
    const options = effective(args);
    let ports = 0;
    let profiles = 0;
    for (const arg of options) {
        const features = arg.match(/^--(?:enable|disable)-features=([\s\S]*)$/)?.[1];
        assert.ok(
            features === undefined || features === '' || features.split(',').every((entry) => entry.trim().length > 0),
            'Empty feature-list entries are malformed experiment inputs.',
        );
        const trimmed = arg.replace(/^[\s\u0085]+|[\s\u0085]+$/g, '');
        if (/^[-/]+\s*remote-debugging-(?:port|pipe)(?:[=:\s]|$)/i.test(trimmed)) {
            assert.equal(arg, portArgument, 'One canonical explicit debugging port carrier is required.');
            ports += 1;
        }
        if (/^[-/]+\s*user-data-dir(?:[=:\s]|$)/i.test(trimmed)) {
            assert.equal(application, 'obsidian', 'Readest profile must use its canonical environment carrier.');
            assert.ok(arg.startsWith('--user-data-dir='), 'Ambiguous profile switch.');
            fixturePath(arg.slice('--user-data-dir='.length));
            profiles += 1;
        }
    }
    assert.equal(ports, 1, 'One canonical explicit debugging port carrier is required.');
    assert.equal(profiles, application === 'obsidian' ? 1 : 0, 'One confined fresh application profile is required.');
}

function validateLaunch(launch: ApplicationLaunch, application: 'obsidian' | 'readest', source: string) {
    const env = launch.env ?? {};
    environmentKeys(env);
    if (launch.executable.includes('{fixture}')) {
        assert.ok(
            application === 'readest' && launch.executable === controlledExecutable,
            'Uncontrolled fixture executable.',
        );
    } else assert.ok(launch.executable === source, 'Executable must be the explicitly hashed source.');
    for (const setting of [launch.executable, ...(launch.args ?? []), launch.cwd ?? '', ...Object.values(env)]) {
        safeLiteral(setting);
        if (setting.includes('{fixture}')) {
            const match = setting.match(/^(?:--[^=\s]+=)?(\{fixture\}\/[\s\S]+)$/);
            assert.ok(match?.[1], 'Fixture placeholder must name a confined literal path.');
            fixturePath(match[1]);
        }
        if (setting.includes('{port}')) {
            assert.ok(
                setting === portArgument || (application === 'readest' && setting === env[browserArguments]),
                'Port placeholder requires its explicit carrier.',
            );
        }
    }
    for (const [key, value] of Object.entries(env)) {
        if (/^WEBVIEW2_/i.test(key)) {
            assert.ok(
                application === 'readest' && [browserArguments, profileEnvironment].includes(key),
                'Conflicting WebView2 environment carrier.',
            );
        }
        if (key !== browserArguments) {
            assert.ok(
                !/--remote-debugging-(?:port|pipe)(?:[=:\s]|$)/i.test(value),
                'Uncontrolled environment debugging carrier.',
            );
        }
    }
    if (application === 'obsidian') validateBrowserOptions(launch.args ?? [], application);
    else {
        const profile = env[profileEnvironment];
        const options = env[browserArguments];
        text(profile);
        text(options);
        fixturePath(profile);
        validateBrowserOptions(browserSwitches(options), application);
        for (const arg of effective(launch.args ?? [])) {
            assert.ok(
                !/^[-/]+\s*(?:remote-debugging-(?:port|pipe)|user-data-dir|(?:enable|disable)-features|single-argument)(?:[=:\s]|$)/i.test(
                    arg.trim(),
                ),
                'Readest browser switches require the canonical environment carrier.',
            );
        }
    }
}

export function parseApplicationScreenshotFixture(
    value: unknown,
    inheritedEnvironment: Record<string, string | undefined> = {},
): ApplicationScreenshotFixture {
    fields(value, ['application', 'source', 'baseline', 'candidate', 'fixtureFiles', 'page']);
    assert.ok(value.application === 'obsidian' || value.application === 'readest', 'Unknown application fixture.');
    fields(value.source, ['executable', 'sha256']);
    text(value.source.executable);
    absolutePath(value.source.executable);
    assert.ok(
        typeof value.source.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.source.sha256),
        'Required lowercase SHA256 hash.',
    );
    const baseline = parseApplicationLaunch(value.baseline);
    const candidate = parseApplicationLaunch(value.candidate);
    environmentKeys(inheritedEnvironment);
    if (value.application === 'readest') {
        assert.ok(
            !Object.entries(inheritedEnvironment).some(
                ([name, setting]) => /^WEBVIEW2_/i.test(name) && setting !== undefined,
            ),
            'Inherited WebView2 environment conflicts with the explicit fixture.',
        );
    }
    validateLaunch(baseline, value.application, value.source.executable);
    validateLaunch(candidate, value.application, value.source.executable);
    const baselineBrowser =
        value.application === 'obsidian'
            ? (baseline.args ?? [])
            : browserSwitches(baseline.env?.[browserArguments] ?? '');
    const candidateBrowser =
        value.application === 'obsidian'
            ? (candidate.args ?? [])
            : browserSwitches(candidate.env?.[browserArguments] ?? '');
    const added = withChromeScreenshotFeature(baselineBrowser);
    assert.ok(!isDeepStrictEqual(added, baselineBrowser), 'Baseline must not enable the target feature.');
    assert.ok(
        isDeepStrictEqual(withChromeScreenshotFeature(candidateBrowser), candidateBrowser),
        'Candidate must enable one canonical bare screenshot feature.',
    );
    const baselineHasEnable = effective(baselineBrowser).some((arg) => arg.startsWith('--enable-features='));
    const cleanedCandidate = candidateBrowser.flatMap((arg, index) => {
        if (index >= effective(candidateBrowser).length || !arg.startsWith('--enable-features=')) return [arg];
        const remaining = arg
            .slice('--enable-features='.length)
            .split(',')
            .filter((entry) => entry !== 'CDPScreenshotNewSurface');
        return remaining.length || baselineHasEnable ? [`--enable-features=${remaining.join(',')}`] : [];
    });
    assert.ok(
        isDeepStrictEqual(cleanedCandidate, baselineBrowser),
        'Candidate may only add one canonical bare screenshot feature.',
    );
    const comparableCandidate = structuredClone(candidate);
    if (value.application === 'obsidian') {
        if (baseline.args === undefined) delete comparableCandidate.args;
        else comparableCandidate.args = baseline.args;
    } else {
        assert.ok(comparableCandidate.env && baseline.env);
        comparableCandidate.env[browserArguments] = baseline.env[browserArguments] ?? '';
    }
    assert.ok(
        isDeepStrictEqual(comparableCandidate, baseline),
        'Only the browser screenshot feature may differ between templates.',
    );
    fields(value.page, ['url', 'title', 'identity']);
    text(value.page.url);
    assert.ok(URL.canParse(value.page.url), 'Expected main-page URL must be a URL.');
    if (value.page.title !== undefined) text(value.page.title);
    if (value.page.identity !== undefined) text(value.page.identity);
    assert.ok(
        value.page.title !== undefined || value.page.identity !== undefined,
        'Known page title or synthetic identity is required.',
    );
    const fixtureFiles: Record<string, string> = {};
    const fileNames = new Set<string>();
    assert.ok(isRecord(value.fixtureFiles), 'Synthetic fixture files are required.');
    for (const [file, contents] of Object.entries(value.fixtureFiles)) {
        safeRelative(file);
        assert.ok(
            typeof contents === 'string' && contents.isWellFormed() && !contents.includes('\0'),
            'Fixture files must be synthetic UTF8 text.',
        );
        safeLiteral(contents);
        const normalized = file.replaceAll('\\', '/').toLowerCase();
        assert.ok(
            ![...fileNames].some(
                (existing) =>
                    existing === normalized ||
                    existing.startsWith(`${normalized}/`) ||
                    normalized.startsWith(`${existing}/`),
            ),
            'Windows fixture file aliases or file-directory paths conflict.',
        );
        fileNames.add(normalized);
        assert.ok(
            value.application !== 'readest' || !/^native(?:\/|$)/.test(normalized),
            'Fixture text cannot overwrite the controlled native executable directory.',
        );
        fixtureFiles[file] = contents;
    }
    return {
        application: value.application,
        source: { executable: value.source.executable, sha256: value.source.sha256 },
        baseline,
        candidate,
        fixtureFiles,
        page: {
            url: value.page.url,
            ...(value.page.title === undefined ? {} : { title: value.page.title }),
            ...(value.page.identity === undefined ? {} : { identity: value.page.identity }),
        },
    };
}

function pathApi(directory: string) {
    return path.win32.isAbsolute(directory) ? path.win32 : path.posix;
}

function confinedFile(directory: string, relative: string) {
    safeRelative(relative);
    const api = pathApi(directory);
    const file = api.resolve(directory, relative);
    const remaining = api.relative(directory, file);
    assert.ok(
        remaining && !remaining.startsWith('..') && !api.isAbsolute(remaining),
        'Expanded path escapes its fixture.',
    );
    return file.replaceAll('\\', '/');
}

export function expandApplicationScreenshotLaunch(
    value: unknown,
    arm: 'baseline' | 'candidate',
    directory: string,
): ApplicationLaunch {
    const fixture = parseApplicationScreenshotFixture(value);
    absolutePath(directory);
    assert.ok(arm === 'baseline' || arm === 'candidate', 'Unknown experiment arm.');
    const expand = (setting: string) => setting.replaceAll('{fixture}', directory.replaceAll('\\', '/'));
    const launch = fixture[arm];
    return {
        executable: expand(launch.executable),
        ...(launch.args === undefined ? {} : { args: launch.args.map(expand) }),
        ...(launch.cwd === undefined ? {} : { cwd: expand(launch.cwd) }),
        ...(launch.env === undefined
            ? {}
            : {
                  env: Object.fromEntries(Object.entries(launch.env).map(([name, setting]) => [name, expand(setting)])),
              }),
    };
}

const nativeIO: ApplicationScreenshotFixtureIO = {
    readFile,
    async createFreshDirectory(parent) {
        return mkdtemp(path.join(parent, 'application-screenshot-'));
    },
    async writeFile(file, contents) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, contents, { flag: 'wx' });
    },
};

export async function prepareApplicationScreenshotFixture(
    value: unknown,
    arm: 'baseline' | 'candidate',
    options: {
        parentDirectory: string;
        inheritedEnvironment?: Record<string, string | undefined>;
        io?: ApplicationScreenshotFixtureIO;
    },
): Promise<PreparedApplicationScreenshotFixture> {
    // Parse the entire pair before reading, acquiring a directory or writing anything.
    const fixture = parseApplicationScreenshotFixture(value, options.inheritedEnvironment);
    absolutePath(options.parentDirectory);
    assert.ok(arm === 'baseline' || arm === 'candidate', 'Unknown experiment arm.');
    const io = options.io ?? nativeIO;
    const sourceBytes = await io.readFile(fixture.source.executable);
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    const sourceSha256 = hash(sourceBytes);
    assert.equal(sourceSha256, fixture.source.sha256, 'Source executable hash mismatch.');
    const directory = (await io.createFreshDirectory(options.parentDirectory)).replaceAll('\\', '/');
    absolutePath(directory);
    const api = pathApi(options.parentDirectory);
    const relative = api.relative(options.parentDirectory, directory);
    assert.ok(
        relative && !relative.startsWith('..') && !api.isAbsolute(relative),
        'Fresh directory must be a new confined descendant.',
    );
    const launch = expandApplicationScreenshotLaunch(fixture, arm, directory);
    let copySha256: string | undefined;
    if (fixture.application === 'readest' && fixture[arm].executable === controlledExecutable) {
        const executable = confinedFile(directory, 'native/readest.exe');
        await io.writeFile(executable, sourceBytes);
        copySha256 = hash(await io.readFile(executable));
        assert.equal(copySha256, sourceSha256, 'Fresh executable copy hash mismatch.');
    }
    for (const [file, contents] of Object.entries(fixture.fixtureFiles)) {
        await io.writeFile(
            confinedFile(directory, file),
            Buffer.from(contents.replaceAll('{fixture}', directory), 'utf8'),
        );
    }
    return { fixture, directory, launch, sourceSha256, ...(copySha256 === undefined ? {} : { copySha256 }) };
}

export function applicationScreenshotGatewayEnvironment(
    environment: Record<string, string | undefined>,
): Record<string, string> {
    environmentKeys(environment);
    return Object.fromEntries(
        Object.entries(environment).flatMap(([name, value]) =>
            value === undefined || /^WEBVIEW2_/i.test(name) ? [] : [[name.toUpperCase(), value]],
        ),
    );
}
