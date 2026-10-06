import assert from 'node:assert/strict';
import path from 'node:path';
import { withChromeScreenshotFeature } from '../../src/domains/chromium-features.ts';
import { type ApplicationLaunch, parseApplicationLaunch } from '../../src/domains/launch-command.ts';
import { isRecord } from '../../src/shared/errors.ts';
import { assertWindowState, type WindowSample } from './window-evidence.ts';

export interface ScreenshotFixture {
    label: string;
    targetKind: 'chrome' | 'generic-cdp';
    launch: ApplicationLaunch;
    candidateArgs: string[];
    pageTitle: string;
    fixtureFiles: Record<string, string>;
    minimizeFunction?: string;
}
const feature = 'CDPScreenshotNewSurface';

function withoutCandidate(args: string[], candidate: boolean) {
    withChromeScreenshotFeature(args);
    const separator = args.indexOf('--');
    const options = args.slice(0, separator < 0 ? args.length : separator);
    let occurrences = 0;
    const cleaned = options.flatMap((arg) => {
        if (!/^--(?:enable|disable)-features=/.test(arg)) return [arg];
        const [switchName, ...value] = arg.split('=');
        const entries = value.join('=').split(',');
        const remaining = entries.filter((entry) => {
            if (entry !== feature) return true;
            assert.equal(switchName, '--enable-features', 'Explicit disabled feature conflicts with the candidate.');
            assert.equal(entry, feature, 'Parameterized/default target feature is ambiguous.');
            occurrences += 1;
            return false;
        });
        return remaining.length ? [`${switchName}=${remaining.join(',')}`] : [];
    });
    assert.equal(occurrences, candidate ? 1 : 0, 'The candidate must add exactly one bare feature before --.');
    return [...cleaned, ...(separator < 0 ? [] : args.slice(separator))];
}

export function parseScreenshotFixture(value: unknown): ScreenshotFixture {
    assert.ok(isRecord(value));
    assert.ok(
        Object.keys(value).every((key) =>
            [
                'label',
                'targetKind',
                'launch',
                'candidateArgs',
                'pageTitle',
                'fixtureFiles',
                'minimizeFunction',
            ].includes(key),
        ),
    );
    assert.ok(typeof value.label === 'string' && /^[a-z][a-z0-9-]*$/.test(value.label));
    assert.ok(value.targetKind === 'chrome' || value.targetKind === 'generic-cdp');
    assert.equal(
        value.targetKind,
        'generic-cdp',
        'Fixed Windows Chrome presets enable both arms; use an explicit experimental generic-cdp raw launch comparison.',
    );
    const launch = parseApplicationLaunch(value.launch);
    const candidateArgs = parseApplicationLaunch({ executable: launch.executable, args: value.candidateArgs }).args;
    assert.ok(candidateArgs);
    assert.ok(
        [...(launch.args ?? []), launch.cwd ?? '', ...Object.values(launch.env ?? {})].some((arg) =>
            arg.includes('{fixture}'),
        ),
        'Launch must explicitly use the new fixture directory.',
    );
    assert.deepEqual(
        withoutCandidate(candidateArgs, true),
        withoutCandidate(launch.args ?? [], false),
        'Only the screenshot feature may differ.',
    );
    assert.ok(typeof value.pageTitle === 'string' && value.pageTitle.length > 0);
    assert.ok(value.minimizeFunction === undefined || typeof value.minimizeFunction === 'string');
    const fixtureFiles: Record<string, string> = {};
    if (value.fixtureFiles !== undefined) {
        assert.ok(isRecord(value.fixtureFiles));
        for (const [file, contents] of Object.entries(value.fixtureFiles)) {
            assert.ok(
                file &&
                    !file.includes('\0') &&
                    !path.posix.isAbsolute(file) &&
                    !path.win32.isAbsolute(file) &&
                    !file.split(/[\\/]/).includes('..'),
                'Fixture file escapes its new directory.',
            );
            assert.ok(typeof contents === 'string');
            fixtureFiles[file] = contents;
        }
    }
    return {
        label: value.label,
        targetKind: value.targetKind,
        launch,
        candidateArgs,
        pageTitle: value.pageTitle,
        fixtureFiles,
        ...(value.minimizeFunction === undefined ? {} : { minimizeFunction: value.minimizeFunction }),
    };
}

export function expandFixture(launch: ApplicationLaunch, directory: string): ApplicationLaunch {
    const expand = (value: string) => value.replaceAll('{fixture}', directory.replaceAll('\\', '/'));
    return {
        executable: launch.executable,
        args: launch.args?.map(expand) ?? [],
        ...(launch.cwd === undefined ? {} : { cwd: expand(launch.cwd) }),
        ...(launch.env === undefined
            ? {}
            : { env: Object.fromEntries(Object.entries(launch.env).map(([name, value]) => [name, expand(value)])) }),
    };
}

export function assertPixels(
    value: unknown,
    expected: { width: number; height: number; points: { x: number; y: number }[]; color: number[] },
) {
    assert.ok(isRecord(value));
    assert.equal(value.width, expected.width, 'PNG width differs from the rendered fixture.');
    assert.equal(value.height, expected.height, 'PNG height differs from the rendered fixture.');
    assert.ok(Array.isArray(value.pixels));
    assert.equal(value.pixels.length, expected.points.length, 'PNG sampling is incomplete.');
    for (const [index, point] of expected.points.entries()) {
        const pixel: unknown = value.pixels[index];
        assert.ok(isRecord(pixel));
        assert.equal(pixel.x, point.x);
        assert.equal(pixel.y, point.y);
        assert.equal(pixel.a, 255, 'Screenshot patch is transparent.');
        assert.deepEqual(
            [pixel.r, pixel.g, pixel.b],
            expected.color,
            'Screenshot contains stale or incorrect content pixels.',
        );
    }
}

interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface ScreenshotGeometry {
    dpr: number;
    viewport: Rectangle;
    content: Rectangle;
    element: Rectangle;
    visualViewport: { scale: number; pageLeft: number; pageTop: number };
}

export function readScreenshotGeometry(value: unknown): ScreenshotGeometry {
    assert.ok(isRecord(value) && isRecord(value.root) && isRecord(value.visualViewport));
    assert.ok(typeof value.dpr === 'number' && Number.isFinite(value.dpr) && value.dpr > 0);
    const rectangle = (box: unknown): Rectangle => {
        assert.ok(isRecord(box));
        for (const name of ['x', 'y', 'width', 'height'])
            assert.ok(typeof box[name] === 'number' && Number.isFinite(box[name]));
        assert.ok(Number(box.width) > 0 && Number(box.height) > 0);
        return { x: Number(box.x), y: Number(box.y), width: Number(box.width), height: Number(box.height) };
    };
    const viewport = rectangle(value.viewport);
    const content = rectangle(value.root.rect);
    const element = rectangle(value.element);
    assert.equal(viewport.x, 0);
    assert.equal(viewport.y, 0);
    assert.equal(content.x, 0, 'Fixture content must begin at the document origin.');
    assert.equal(content.y, 0, 'Fixture must not be scrolled.');
    assert.equal(value.root.scrollWidth, Math.round(content.width), 'Unmeasured horizontal root overflow.');
    assert.equal(value.root.scrollHeight, Math.round(content.height), 'Unmeasured vertical root overflow.');
    assert.equal(value.visualViewport.scale, 1, 'Pinch-zoom is outside the fixture contract.');
    assert.equal(value.visualViewport.pageLeft, 0);
    assert.equal(value.visualViewport.pageTop, 0);
    return { dpr: value.dpr, viewport, content, element, visualViewport: { scale: 1, pageLeft: 0, pageTop: 0 } };
}

export function screenshotSize(shape: string, geometry: ScreenshotGeometry) {
    const { dpr } = geometry;
    if (shape === 'viewport')
        return { width: Math.round(geometry.viewport.width * dpr), height: Math.round(geometry.viewport.height * dpr) };
    if (shape === 'fullPage') {
        // Blink GetFullPageSize converts snapped physical ContentsSize to floored
        // CSS integers with a float reciprocal; PageHandler scales these back.
        const dimension = (css: number) => {
            const physical = Math.round(css * dpr);
            const flooredCss = Math.floor(Math.fround(physical * Math.fround(1 / dpr)));
            return Math.round(Math.fround(flooredCss * dpr));
        };
        return { width: dimension(geometry.content.width), height: dimension(geometry.content.height) };
    }
    assert.equal(shape, 'element');
    // Puppeteer roundRectangle rounds clip origin before its far edges.
    const clip = geometry.element;
    const width = Math.round(clip.width + clip.x - Math.round(clip.x));
    const height = Math.round(clip.height + clip.y - Math.round(clip.y));
    return { width: Math.round(Math.fround(width * dpr)), height: Math.round(Math.fround(height * dpr)) };
}

export async function screenshotShapes<T>(
    phase: string,
    candidate: boolean,
    peer: T | undefined,
    capture: (shape: string, peer: T | undefined) => Promise<{ timeout: boolean }>,
) {
    for (const shape of ['viewport', 'fullPage', 'element']) {
        const result = await capture(shape, peer);
        if (result.timeout) {
            assert.equal(candidate, false, 'Candidate timed out.');
            assert.ok(phase === 'B' || phase === 'C', 'Normal baseline control timed out; comparison is incomplete.');
            return true;
        }
    }
    return false;
}

export async function prepareScreenshotWindow(
    initial: WindowSample,
    restore: (handle: number) => Promise<WindowSample>,
) {
    assertWindowState(initial, initial.isIconic ? 'minimized' : 'normal');
    const prepared = initial.isIconic ? await restore(initial.handle) : initial;
    assertWindowState(prepared, 'normal', initial);
    return prepared;
}

export function closeEvery<T>(actions: (() => Promise<T>)[]) {
    return Promise.allSettled(actions.map((action) => Promise.resolve().then(action)));
}

export function screenshotPhase(
    before: unknown,
    after: unknown,
    session: string,
    enforceThreshold = true,
): number | undefined {
    assert.ok(Array.isArray(before) && before.length > 0 && Array.isArray(after));
    for (const event of [...before, ...after]) {
        assert.ok(isRecord(event) && event.sessionId === session);
        assert.ok(
            typeof event.phase === 'string' &&
                [
                    'connection-health',
                    'identity-check',
                    'discovery-response',
                    'cdp-connect',
                    'cdp-response',
                    'cdp-screenshot',
                    'upstream-processing',
                    'result-ready',
                ].includes(event.phase),
        );
        assert.ok(['completed', 'failed', 'interrupted'].includes(String(event.outcome)));
        assert.ok(typeof event.elapsedMs === 'number' && Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0);
    }
    const count = Math.min(before.length, 40);
    const anchor = before.slice(-count);
    let offset = -1;
    for (let index = 0; index <= after.length - count; index += 1) {
        if (JSON.stringify(after.slice(index, index + count)) === JSON.stringify(anchor)) {
            if (offset !== -1) return undefined;
            offset = index + count;
        }
    }
    if (offset < 0) return undefined;
    const captures = after
        .slice(offset)
        .filter(isRecord)
        .filter((event) => event.phase === 'cdp-screenshot');
    assert.equal(captures.length, 1, 'Expected one new screenshot phase.');
    const capture = captures[0];
    assert.ok(
        capture &&
            capture.outcome === 'completed' &&
            typeof capture.elapsedMs === 'number' &&
            (!enforceThreshold || capture.elapsedMs < 5000),
        'Screenshot phase exceeded acceptance threshold.',
    );
    return capture.elapsedMs;
}
