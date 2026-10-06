import assert from 'node:assert/strict';
import path from 'node:path';
import { type ApplicationLaunch, parseApplicationLaunch } from '../../src/domains/launch-command.ts';
import { errorMessage, isRecord } from '../../src/shared/errors.ts';
import type { McpRequestInterval } from './mcp-client.ts';
import { cancelledPassiveSample } from './screenshot-capture-observer.ts';
import { expandFixture } from './screenshot-fixture.ts';
import { assertWindowState, readWindowSample, type WindowIdentity, type WindowSample } from './window-evidence.ts';

export interface ScreenshotTimeoutFixture {
    label: string;
    url: string;
    launch: ApplicationLaunch;
    background: boolean;
    fullPage: boolean;
    bringToFront?: boolean;
    windowCondition?: WindowCondition;
    colorScheme: 'light' | 'dark';
    viewport: string;
    evaluations: { function: string; waitForStableDom?: boolean }[];
}
export type WindowCondition = 'foreground-normal' | 'background-normal' | 'minimized';
export interface ScreenshotTimeoutRoute {
    identity: WindowIdentity;
    call(name: string, args: Record<string, unknown>, interval?: McpRequestInterval): Promise<Record<string, unknown>>;
    status(): Promise<unknown>;
    sample(handle?: number): Promise<unknown>;
    condition(condition: WindowCondition, handle: number): Promise<unknown>;
    capture(
        call: (interval: McpRequestInterval) => Promise<Record<string, unknown>>,
        handle: number,
        observe: (action: () => Promise<unknown>) => Promise<void>,
    ): Promise<Record<string, unknown>>;
    png(filePath: string): Promise<unknown>;
}
export interface ScreenshotTimeoutAdapter {
    acquire(fixture: ScreenshotTimeoutFixture): Promise<ScreenshotTimeoutRoute>;
    cleanup(): Promise<unknown>;
    record(kind: string, value: unknown): Promise<void>;
}
type Outcome = 'success' | 'tool-error' | 'recovery-required' | 'client-error' | 'blocked-evidence';
const environmentToken = /%[A-Za-z_][A-Za-z\d_]*%|\$\{[A-Za-z_][A-Za-z\d_]*\}/;

function profilePaths(launch: ApplicationLaunch) {
    return (launch.args ?? []).flatMap((arg, index, args) =>
        arg.startsWith('--user-data-dir=')
            ? [arg.slice('--user-data-dir='.length)]
            : arg === '--user-data-dir'
              ? [args[index + 1]]
              : [],
    );
}

export function parseScreenshotTimeoutFixture(value: unknown): ScreenshotTimeoutFixture {
    assert.ok(isRecord(value), 'Fixture must be an object.');
    assert.ok(
        Object.keys(value).every((key) =>
            [
                'label',
                'url',
                'launch',
                'background',
                'fullPage',
                'bringToFront',
                'windowCondition',
                'colorScheme',
                'viewport',
                'evaluations',
            ].includes(key),
        ),
        'Unknown fixture field.',
    );
    assert.ok(typeof value.label === 'string' && /^[a-z][a-z0-9-]*$/.test(value.label), 'Invalid fixture label.');
    assert.ok(typeof value.url === 'string' && value.url.length > 0 && !value.url.includes('\0'), 'Invalid URL.');
    new URL(value.url);
    assert.ok(
        typeof value.background === 'boolean' && typeof value.fullPage === 'boolean',
        'Boolean capture fields required.',
    );
    assert.ok(value.bringToFront === undefined || typeof value.bringToFront === 'boolean', 'Invalid bringToFront.');
    assert.ok(
        value.windowCondition === undefined ||
            value.windowCondition === 'foreground-normal' ||
            value.windowCondition === 'background-normal' ||
            value.windowCondition === 'minimized',
        'Invalid windowCondition.',
    );
    assert.ok(value.colorScheme === 'light' || value.colorScheme === 'dark', 'Invalid colorScheme.');
    assert.ok(
        typeof value.viewport === 'string' && value.viewport.length > 0 && !value.viewport.includes('\0'),
        'Invalid viewport.',
    );
    const launch = parseApplicationLaunch(value.launch);
    assert.ok(
        launch.args?.some((arg) => arg.includes('{fixture}')),
        'Launch args must use the fresh fixture.',
    );
    assert.ok(!launch.executable.includes('{fixture}'), 'Fixture cannot replace the executable.');
    for (const setting of [...(launch.args ?? []), launch.cwd ?? '', ...Object.values(launch.env ?? {})]) {
        if (setting.includes('{fixture}')) {
            assert.ok(!setting.split(/[\\/]/).includes('..'), 'Fixture path escapes its fresh directory.');
        }
    }
    const profiles = profilePaths(launch);
    assert.ok(
        profiles.length === 1 && profiles[0]?.startsWith('{fixture}/'),
        'One explicitly confined fresh profile is required.',
    );
    assert.ok(
        !environmentToken.test(profiles[0] ?? ''),
        'Environment substitutions cannot establish a confined fresh profile.',
    );
    assert.ok(Array.isArray(value.evaluations), 'Evaluations must be an array.');
    const evaluations = value.evaluations.map((evaluation: unknown) => {
        assert.ok(
            isRecord(evaluation) &&
                Object.keys(evaluation).every((key) => ['function', 'waitForStableDom'].includes(key)),
        );
        assert.ok(typeof evaluation.function === 'string' && evaluation.function.length > 0);
        assert.ok(evaluation.waitForStableDom === undefined || typeof evaluation.waitForStableDom === 'boolean');
        return {
            function: evaluation.function,
            ...(evaluation.waitForStableDom === undefined ? {} : { waitForStableDom: evaluation.waitForStableDom }),
        };
    });
    return {
        label: value.label,
        url: value.url,
        launch,
        background: value.background,
        fullPage: value.fullPage,
        colorScheme: value.colorScheme,
        viewport: value.viewport,
        evaluations,
        ...(value.bringToFront === undefined ? {} : { bringToFront: value.bringToFront }),
        ...(value.windowCondition === undefined ? {} : { windowCondition: value.windowCondition }),
    };
}

function pageIds(result: Record<string, unknown>): number[] {
    assert.ok(Array.isArray(result.content), 'Official page result has no content.');
    const text = result.content
        .filter(isRecord)
        .flatMap((item) => (item.type === 'text' && typeof item.text === 'string' ? [item.text] : []))
        .join('\n');
    return [...text.matchAll(/^(\d+):/gm)].map((match) => Number(match[1]));
}

export function correlateNativeTabs(observed: unknown, pageTitle?: string) {
    const providers: {
        provider: string;
        reliability: 'reliable' | 'unknown';
        reason: string;
        selectedTitle?: string;
    }[] = ['uia', 'msaa'].map((provider) => {
        const observation = isRecord(observed) ? observed[provider] : undefined;
        const unknown = (reason: string) => ({ provider, reliability: 'unknown' as const, reason });
        if (!isRecord(observation)) return unknown('missing-provider');
        if (observation.incomplete === true) return unknown('incomplete');
        if (observation.status !== 'supported') return unknown('unsupported');
        if (
            !Array.isArray(observation.tabs) ||
            !observation.tabs.every(
                (tab: unknown) =>
                    isRecord(tab) &&
                    typeof tab.name === 'string' &&
                    tab.name.length > 0 &&
                    typeof tab.selected === 'boolean',
            )
        )
            return unknown('invalid-tabs');
        const tabs = observation.tabs.filter(isRecord);
        const active = tabs.filter((tab) => tab.selected === true);
        if (active.length !== 1) return unknown(active.length > 1 ? 'multiple-selected' : 'no-selected');
        const selected = active[0];
        assert.ok(selected && typeof selected.name === 'string');
        if (tabs.filter((tab) => tab.name === selected.name).length !== 1) return unknown('duplicate-selected-title');
        return { provider, reliability: 'reliable', reason: 'unique-selected', selectedTitle: selected.name };
    });
    const selectedTitles = providers.flatMap((provider) =>
        provider.selectedTitle === undefined ? [] : [provider.selectedTitle],
    );
    const unique = [...new Set(selectedTitles)];
    const reliable = providers.every((provider) => provider.reliability === 'reliable');
    const matches = reliable && pageTitle !== undefined && unique.length === 1 && unique[0] === pageTitle;
    return {
        providers,
        selectedTitles,
        correlation: matches ? 'unique-title-match' : 'unknown',
        reason: !reliable
            ? 'unreliable-provider'
            : unique.length !== 1
              ? 'conflicting-providers'
              : matches
                ? 'provider-agreement'
                : 'page-title-mismatch',
    };
}

export async function runScreenshotTimeoutProbe(value: unknown, filePath: string, adapter: ScreenshotTimeoutAdapter) {
    // Validation precedes acquisition: malformed fixtures cannot start a gateway or target.
    const fixture = parseScreenshotTimeoutFixture(value);
    const launch = expandFixture(fixture.launch, path.dirname(filePath));
    assert.ok(
        !environmentToken.test(profilePaths(launch)[0] ?? ''),
        'The expanded fresh profile cannot contain environment substitutions.',
    );
    let outcome: Outcome = 'client-error';
    let failure: string | undefined;
    let capture: { outcome: Outcome; result?: Record<string, unknown>; error?: string } | undefined;
    let captureResult: Record<string, unknown> | undefined;
    const observations: { performed: boolean; ok: boolean; errors: { kind: string; error: string }[] } = {
        performed: false,
        ok: false,
        errors: [],
    };
    let cleanup: { ok: boolean; result?: unknown; error?: string } = { ok: false };
    let route: ScreenshotTimeoutRoute | undefined;
    const call = async (name: string, args: Record<string, unknown>, interval?: McpRequestInterval) => {
        assert.ok(route);
        await adapter.record('official-request', { name, arguments: args });
        const result = await route.call(name, args, interval);
        if (name === 'take_screenshot') captureResult = result;
        await adapter.record('official-result', { name, result });
        if (isRecord(result.structuredContent) && result.structuredContent.code === 'CONNECTION_RECOVERY_REQUIRED') {
            outcome = 'recovery-required';
            throw new Error('Gateway requires explicit recovery.');
        }
        if (result.isError === true) {
            outcome = 'tool-error';
            throw new Error(`Official ${name} returned isError:true.`);
        }
        return result;
    };
    const validate = async (
        raw: unknown,
        handle?: number,
        previous?: WindowSample,
        expectedCondition = fixture.windowCondition,
        requireState = true,
        kind = 'native-validated',
    ) => {
        assert.ok(route);
        await adapter.record('native-raw', raw);
        const observed = readWindowSample(raw, route.identity, handle);
        assert.ok(typeof observed.actualExecutablePath === 'string', 'Native executable path is unavailable.');
        if (requireState) {
            assertWindowState(observed, expectedCondition === 'minimized' ? 'minimized' : 'normal', previous);
            if (expectedCondition !== undefined) {
                assert.ok(observed.foregroundHwnd !== undefined, 'Foreground HWND evidence is unavailable.');
                if (expectedCondition === 'foreground-normal')
                    assert.equal(
                        observed.foregroundHwnd,
                        observed.handle,
                        'Owned window lost the required foreground condition.',
                    );
                if (expectedCondition === 'background-normal')
                    assert.notEqual(
                        observed.foregroundHwnd,
                        observed.handle,
                        'Owned window lost the required background condition.',
                    );
            }
        }
        await adapter.record(requireState ? kind : 'native-condition-before', observed);
        return observed;
    };
    const sample = async (handle?: number, previous?: WindowSample) => {
        assert.ok(route);
        try {
            return await validate(await route.sample(handle), handle, previous);
        } catch (error) {
            throw Object.assign(new Error(errorMessage(error)), { probeOutcome: 'blocked-evidence' });
        }
    };
    const observe = async (kind: string, action: () => Promise<unknown>) => {
        try {
            await action();
        } catch (error) {
            const failure = { kind, error: errorMessage(error) };
            observations.errors.push(failure);
            await adapter.record('observation-error', failure);
        }
    };
    try {
        route = await adapter.acquire({ ...fixture, launch });
        const baseline = pageIds(await call('list_pages', {}));
        const created = pageIds(await call('new_page', { url: fixture.url, background: fixture.background })).filter(
            (id) => !baseline.includes(id),
        );
        assert.equal(created.length, 1, 'Expected one freshly returned page ID.');
        const pageId = created[0];
        assert.ok(pageId !== undefined);
        await adapter.record('page-identity', { baseline, pageId });
        if (fixture.bringToFront !== undefined)
            await call('select_page', { pageId, bringToFront: fixture.bringToFront });
        await call('emulate', { pageId, colorScheme: fixture.colorScheme, viewport: fixture.viewport });
        for (let index = 0; index < fixture.evaluations.length; index += 1) {
            const result = await call('evaluate_script', { pageId, ...fixture.evaluations[index] });
            await adapter.record('fixture-evaluation', { index, result });
        }
        const metadata = await call('evaluate_script', {
            pageId,
            function:
                '() => ({title:document.title,url:location.href,hasFocus:document.hasFocus(),visibilityState:document.visibilityState,innerWidth,innerHeight,dpr:devicePixelRatio,scrollX,scrollY,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight})',
            waitForStableDom: false,
        });
        await adapter.record('metadata-observation', metadata);
        let ownedHandle: number | undefined;
        if (fixture.windowCondition !== undefined) {
            try {
                const initial = await validate(await route.sample(), undefined, undefined, undefined, false);
                ownedHandle = initial.handle;
                const raw = await route.condition(fixture.windowCondition, ownedHandle);
                await adapter.record('native-condition-transition', {
                    condition: fixture.windowCondition,
                    raw,
                    basis: 'Explicit native owned-HWND transition; differs from a human click and does not prove compositor occlusion.',
                });
                await validate(raw, ownedHandle, initial);
            } catch (error) {
                throw Object.assign(new Error(errorMessage(error)), { probeOutcome: 'blocked-evidence' });
            }
        }
        const before = await sample(ownedHandle);
        await adapter.record('diagnostics-before', await route.status());
        const activeRoute = route;
        let duringCompleted = 0;
        let requestPending = false;
        let ordering = 0;
        const intervalEvidence: { phase: string; order: number; monotonicMs: number; qualified?: boolean }[] = [];
        const mark = (phase: string, qualified?: boolean) => {
            const event = {
                phase,
                order: ++ordering,
                monotonicMs: performance.now(),
                ...(qualified === undefined ? {} : { qualified }),
            };
            intervalEvidence.push(event);
        };
        try {
            const result = await activeRoute.capture(
                (interval) =>
                    call(
                        'take_screenshot',
                        { pageId, fullPage: fixture.fullPage, filePath },
                        {
                            dispatched() {
                                requestPending = true;
                                mark('request-dispatched');
                                interval.dispatched();
                            },
                            settled() {
                                requestPending = false;
                                mark('request-settled');
                                interval.settled();
                            },
                        },
                    ),
                before.handle,
                (action) =>
                    observe('native-during', async () => {
                        const startedPending = requestPending;
                        mark('sample-started');
                        let validated = false;
                        try {
                            const raw = await action();
                            if (raw === cancelledPassiveSample) return;
                            await validate(
                                raw,
                                before.handle,
                                before,
                                fixture.windowCondition,
                                true,
                                'passive-native-validated',
                            );
                            validated = true;
                        } finally {
                            const qualified = validated && startedPending && requestPending;
                            mark('sample-completed', qualified);
                            if (qualified) duringCompleted += 1;
                        }
                    }),
            );
            outcome = 'success';
            capture = { outcome, result };
        } catch (error) {
            failure = errorMessage(error);
            capture = { outcome, error: failure, ...(captureResult === undefined ? {} : { result: captureResult }) };
        }
        await adapter.record('capture-outcome', capture);
        await observe('capture-interval', () =>
            adapter.record('capture-interval', {
                basis: 'Local MCP request write and resolve-or-reject callbacks; CDP method phases unavailable.',
                duringCompleted,
                events: intervalEvidence,
            }),
        );
        if (fixture.windowCondition !== undefined && duringCompleted === 0)
            await observe('native-during', async () => {
                throw new Error('No passive during-capture window evidence was obtained.');
            });
        observations.performed = true;
        if (capture.outcome === 'success')
            await observe('png', async () => adapter.record('png', await activeRoute.png(filePath)));
        // Post-observation errors cannot replace a primary capture result or error.
        await observe('diagnostics-after', async () => adapter.record('diagnostics-after', await activeRoute.status()));
        await observe('native-after', () => sample(before.handle, before));
        observations.ok = observations.errors.length === 0;
        if (capture.outcome === 'success' && !observations.ok) {
            outcome = 'blocked-evidence';
            failure = observations.errors[0]?.error;
        }
    } catch (error) {
        failure = errorMessage(error);
        if (isRecord(error) && error.probeOutcome === 'blocked-evidence') outcome = 'blocked-evidence';
        if (outcome === 'success') outcome = 'client-error';
        await adapter.record('failure', { outcome, error: failure });
    } finally {
        try {
            cleanup = { ok: true, result: await adapter.cleanup() };
        } catch (error) {
            cleanup = { ok: false, error: errorMessage(error) };
        }
        await adapter.record('cleanup', cleanup);
    }
    const result = { outcome, ...(failure === undefined ? {} : { error: failure }), capture, observations, cleanup };
    await adapter.record('final', result);
    return result;
}
