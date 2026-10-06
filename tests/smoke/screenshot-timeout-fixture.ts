import assert from 'node:assert/strict';
import { type ApplicationLaunch, parseApplicationLaunch } from '../../src/domains/launch-command.ts';
import { errorMessage, isRecord } from '../../src/shared/errors.ts';
import { assertWindowState, readWindowSample, type WindowIdentity, type WindowSample } from './window-evidence.ts';

export interface ScreenshotTimeoutFixture {
    label: string;
    url: string;
    launch: ApplicationLaunch;
    background: boolean;
    fullPage: boolean;
    bringToFront?: boolean;
    colorScheme: 'light' | 'dark';
    viewport: string;
    evaluations: { function: string; waitForStableDom?: boolean }[];
}
export interface ScreenshotTimeoutRoute {
    identity: WindowIdentity;
    call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
    status(): Promise<unknown>;
    sample(handle?: number): Promise<unknown>;
    capture(call: () => Promise<Record<string, unknown>>, handle: number): Promise<Record<string, unknown>>;
    png(filePath: string): Promise<unknown>;
}
export interface ScreenshotTimeoutAdapter {
    acquire(fixture: ScreenshotTimeoutFixture): Promise<ScreenshotTimeoutRoute>;
    cleanup(): Promise<unknown>;
    record(kind: string, value: unknown): Promise<void>;
}
type Outcome = 'success' | 'tool-error' | 'recovery-required' | 'client-error' | 'blocked-evidence';

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
    const profiles = (launch.args ?? []).flatMap((arg, index, args) =>
        arg.startsWith('--user-data-dir=')
            ? [arg.slice('--user-data-dir='.length)]
            : arg === '--user-data-dir'
              ? [args[index + 1]]
              : [],
    );
    assert.ok(
        profiles.length === 1 && profiles[0]?.startsWith('{fixture}/'),
        'One explicitly confined fresh profile is required.',
    );
    assert.ok(
        !/%[A-Za-z_][A-Za-z\d_]*%|\$\{[A-Za-z_][A-Za-z\d_]*\}/.test(profiles[0] ?? ''),
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
    const call = async (name: string, args: Record<string, unknown>) => {
        assert.ok(route);
        await adapter.record('official-request', { name, arguments: args });
        const result = await route.call(name, args);
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
    const sample = async (handle?: number, previous?: WindowSample) => {
        assert.ok(route);
        try {
            const raw = await route.sample(handle);
            await adapter.record('native-raw', raw);
            const observed = readWindowSample(raw, route.identity, handle);
            assert.ok(typeof observed.actualExecutablePath === 'string', 'Native executable path is unavailable.');
            assertWindowState(observed, 'normal', previous);
            await adapter.record('native-validated', observed);
            return observed;
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
        route = await adapter.acquire(fixture);
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
        const before = await sample();
        await adapter.record('diagnostics-before', await route.status());
        const activeRoute = route;
        try {
            const result = await activeRoute.capture(
                () => call('take_screenshot', { pageId, fullPage: fixture.fullPage, filePath }),
                before.handle,
            );
            outcome = 'success';
            capture = { outcome, result };
        } catch (error) {
            failure = errorMessage(error);
            capture = { outcome, error: failure, ...(captureResult === undefined ? {} : { result: captureResult }) };
        }
        await adapter.record('capture-outcome', capture);
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
