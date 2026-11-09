import {
    type ConnectionRoute,
    parseConnectionRoute,
    type RestartScope,
    validateIdentity,
} from '../../domains/control-contract.ts';
import type { PluginHost } from '../../domains/host-management.ts';
import { isRecord } from '../../shared/errors.ts';
import { type AppConfiguration, parseAppConfiguration } from '../configuration/model.ts';
import { type AppUiSnapshot, validateAppManagementFields as fields } from './snapshots.ts';

export const APP_MANAGEMENT_CHANNEL = 'dct-app:manage';

export type AppUiRequest =
    | Readonly<{ action: 'inspect' | 'quit' | 'restart' }>
    | Readonly<{ action: 'configure'; configuration: AppConfiguration }>
    | Readonly<{ action: 'manage'; command: AppManagementCommand }>;

export type AppManagementCommand =
    | { kind: 'restart'; route: ConnectionRoute; scope: RestartScope }
    | { kind: 'close'; routes: ConnectionRoute[] }
    | { kind: 'transfer'; routes: ConnectionRoute[]; registrationId: string }
    | { kind: 'unregister'; registrationId: string }
    | { kind: 'connection'; route: ConnectionRoute }
    | { kind: 'operation-status'; operationId: string }
    | { kind: 'operation-cancel'; operationId: string }
    | { kind: 'operation-wait'; operationId: string; cursor: number }
    | { kind: 'host-inspect'; host: PluginHost }
    | { kind: 'host-sync'; host: PluginHost };

export type AppUiBridge = Readonly<{
    inspect(): Promise<AppUiSnapshot>;
    configure(configuration: AppConfiguration): Promise<AppUiSnapshot>;
    manage(command: AppManagementCommand): Promise<AppUiSnapshot>;
    quit(): Promise<void>;
    restart(): Promise<void>;
}>;

export function parseAppUiRequest(value: unknown): AppUiRequest {
    if (!isRecord(value)) throw new Error('Invalid management request.');
    if (value.action === 'configure') {
        fields(value, ['action', 'configuration']);
        return Object.freeze({ action: 'configure', configuration: parseAppConfiguration(value.configuration) });
    }
    if (value.action === 'manage') {
        fields(value, ['action', 'command']);
        return { action: 'manage', command: parseAppManagementCommand(value.command) };
    }
    fields(value, ['action']);
    if (value.action !== 'inspect' && value.action !== 'quit' && value.action !== 'restart')
        throw new Error('Unsupported management action.');
    return Object.freeze({ action: value.action });
}

export function parseAppManagementCommand(input: unknown): AppManagementCommand {
    if (!isRecord(input)) throw new Error('Invalid management command.');
    const id = (value: unknown) => {
        validateIdentity(value, 'management identity');
        return value;
    };
    const routes = (value: unknown) => {
        if (!Array.isArray(value) || value.length < 1 || value.length > 256)
            throw new Error('Select between 1 and 256 connections.');
        const result = value.map(parseConnectionRoute);
        if (new Set(result.map((route) => route.connectionId)).size !== result.length)
            throw new Error('Duplicate connection.');
        return result;
    };
    switch (input.kind) {
        case 'restart':
            fields(input, ['kind', 'route', 'scope']);
            if (input.scope !== 'target' && input.scope !== 'official' && input.scope !== 'both')
                throw new Error('Choose a restart scope.');
            return { kind: input.kind, route: parseConnectionRoute(input.route), scope: input.scope };
        case 'connection':
            fields(input, ['kind', 'route']);
            return { kind: input.kind, route: parseConnectionRoute(input.route) };
        case 'close':
            fields(input, ['kind', 'routes']);
            return { kind: input.kind, routes: routes(input.routes) };
        case 'transfer':
            fields(input, ['kind', 'routes', 'registrationId']);
            return { kind: input.kind, routes: routes(input.routes), registrationId: id(input.registrationId) };
        case 'unregister':
            fields(input, ['kind', 'registrationId']);
            return { kind: input.kind, registrationId: id(input.registrationId) };
        case 'operation-status':
        case 'operation-cancel':
            fields(input, ['kind', 'operationId']);
            return { kind: input.kind, operationId: id(input.operationId) };
        case 'operation-wait':
            fields(input, ['kind', 'operationId', 'cursor']);
            if (typeof input.cursor !== 'number' || !Number.isSafeInteger(input.cursor) || input.cursor < 0)
                throw new Error('Invalid operation cursor.');
            return { kind: input.kind, operationId: id(input.operationId), cursor: input.cursor };
        case 'host-inspect':
        case 'host-sync':
            fields(input, ['kind', 'host']);
            if (input.host !== 'codex' && input.host !== 'claude') throw new Error('Invalid host.');
            return { kind: input.kind, host: input.host };
        default:
            throw new Error('Unsupported management command.');
    }
}
