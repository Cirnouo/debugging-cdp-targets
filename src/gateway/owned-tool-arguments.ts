import { type ConnectionRoute, parseConnectionRoute } from '../domains/control-contract.ts';
import { isRecord } from '../shared/errors.ts';

function parseRegistrationBearer(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value))
        throw new Error('A registration bearer is required.');
    return value;
}

export function parseRegistrationBearerArguments(value: unknown): {
    registrationBearer: string;
    arguments: Record<string, unknown>;
} {
    if (!isRecord(value) || !Object.hasOwn(value, 'registrationBearer'))
        throw new Error('A registration bearer is required.');
    const bearer = parseRegistrationBearer(value.registrationBearer);
    const { registrationBearer: _bearer, ...arguments_ } = value;
    return { registrationBearer: bearer, arguments: arguments_ };
}

export function parseOfficialToolArguments(value: unknown): {
    registrationBearer: string;
    route: ConnectionRoute;
    arguments: Record<string, unknown>;
} {
    if (!isRecord(value) || !isRecord(value._dct)) throw new Error('An authenticated connection route is required.');
    const selected = parseRegistrationBearerArguments(value._dct);
    const route = parseConnectionRoute(selected.arguments);
    const { _dct: _route, ...arguments_ } = value;
    return { registrationBearer: selected.registrationBearer, route, arguments: arguments_ };
}
