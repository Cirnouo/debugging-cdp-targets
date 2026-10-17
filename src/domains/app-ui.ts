import { isRecord } from '../shared/errors.ts';
import { type AppConfiguration, type AppConfigurationState, parseAppConfiguration } from './app-configuration.ts';

export const APP_UI_URL = 'dct-app://manager/';
export const APP_MANAGEMENT_CHANNEL = 'dct-app:manage';
const APP_ASSET_PATHS = ['/', '/app-renderer.js', '/app.css', '/icon.png'] as const;

export function appAssetPath(input: string, method: string, initiatorOrigin: unknown) {
    try {
        const url = new URL(input);
        if (
            method !== 'GET' ||
            url.protocol !== 'dct-app:' ||
            url.host !== 'manager' ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            (initiatorOrigin !== undefined && initiatorOrigin !== 'dct-app://manager')
        )
            return undefined;
        return APP_ASSET_PATHS.find((candidate) => candidate === url.pathname);
    } catch {
        return undefined;
    }
}
export type AppUiRequest =
    | Readonly<{ action: 'inspect' | 'quit' | 'restart' }>
    | Readonly<{ action: 'configure'; configuration: AppConfiguration }>;
export type AppUiSnapshot = Readonly<{
    phase: 'starting' | 'ready' | 'closing' | 'failed';
    configuration?: AppConfigurationState;
    message?: string;
}>;
export type AppUiBridge = Readonly<{
    inspect(): Promise<AppUiSnapshot>;
    configure(configuration: AppConfiguration): Promise<AppUiSnapshot>;
    quit(): Promise<void>;
    restart(): Promise<void>;
}>;

function fields(
    value: unknown,
    required: readonly string[],
    optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
    if (
        !isRecord(value) ||
        required.some((key) => !Object.hasOwn(value, key)) ||
        Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
    )
        throw new Error('Invalid management message.');
}

export function parseAppUiRequest(value: unknown): AppUiRequest {
    if (!isRecord(value)) throw new Error('Invalid management request.');
    if (value.action === 'configure') {
        fields(value, ['action', 'configuration']);
        return Object.freeze({ action: 'configure', configuration: parseAppConfiguration(value.configuration) });
    }
    fields(value, ['action']);
    if (value.action !== 'inspect' && value.action !== 'quit' && value.action !== 'restart')
        throw new Error('Unsupported management action.');
    return Object.freeze({ action: value.action });
}

export function parseAppUiSnapshot(value: unknown): AppUiSnapshot {
    fields(value, ['phase'], ['configuration', 'message']);
    if (value.phase !== 'starting' && value.phase !== 'ready' && value.phase !== 'closing' && value.phase !== 'failed')
        throw new Error('Invalid App management phase.');
    let configuration: AppConfigurationState | undefined;
    if (Object.hasOwn(value, 'configuration')) {
        fields(value.configuration, ['desired', 'effective', 'restartRequired']);
        const desired = parseAppConfiguration(value.configuration.desired);
        const effective = parseAppConfiguration(value.configuration.effective);
        if (
            value.configuration.restartRequired !== (desired.port !== effective.port) ||
            desired.appearance !== effective.appearance
        )
            throw new Error('Inconsistent App management settings.');
        configuration = Object.freeze({ desired, effective, restartRequired: desired.port !== effective.port });
    }
    if (value.phase === 'ready' && configuration === undefined)
        throw new Error('Ready App phase requires configuration.');
    if (
        value.message !== undefined &&
        (typeof value.message !== 'string' || !value.message.trim() || value.message.length > 500)
    )
        throw new Error('Invalid App management message.');
    if (value.phase === 'failed' && value.message === undefined)
        throw new Error('Failed App phase requires an explanation.');
    return Object.freeze({
        phase: value.phase,
        ...(configuration === undefined ? {} : { configuration }),
        ...(typeof value.message === 'string' ? { message: value.message } : {}),
    });
}
