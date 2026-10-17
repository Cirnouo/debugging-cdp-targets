import { isRecord } from '../shared/errors.ts';
import { parseConnectionRoute } from './control-contract.ts';

export const MCP_MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;
type HttpRequestEvidence = Readonly<{
    method: string | undefined;
    url: string | undefined;
    headers: Readonly<Record<string, unknown>>;
}>;
type HttpRejection = Readonly<{ status: 400 | 403 | 404 | 405 | 413 | 415; message: string }>;

/** Closed messages never reflect request URLs, headers, bearer material or arguments. */
export function mcpHttpRejection(request: HttpRequestEvidence, effectivePort: number): HttpRejection | undefined {
    if (!Number.isSafeInteger(effectivePort) || effectivePort < 1024 || effectivePort > 65535)
        throw new Error('Invalid effective App endpoint port.');
    const { headers } = request;
    const authority = `127.0.0.1:${effectivePort}`;
    if (headers.host !== authority || (headers.origin !== undefined && headers.origin !== `http://${authority}`))
        return { status: 403, message: 'Untrusted endpoint authority or origin.' };
    // Forwarded headers cannot change the actual loopback endpoint or grant request authority.
    if (request.url !== '/mcp') return { status: 404, message: 'Unknown endpoint.' };
    if (request.method !== 'POST' && request.method !== 'GET' && request.method !== 'DELETE')
        return { status: 405, message: 'Unsupported endpoint method.' };
    const rawLength = headers['content-length'];
    let length = 0;
    if (rawLength !== undefined) {
        if (typeof rawLength !== 'string' || !/^(0|[1-9][0-9]*)$/.test(rawLength))
            return { status: 400, message: 'Invalid request length.' };
        length = Number(rawLength);
        if (!Number.isSafeInteger(length)) return { status: 400, message: 'Invalid request length.' };
        if (length > MCP_MAX_REQUEST_BODY_BYTES) return { status: 413, message: 'Request body exceeds the limit.' };
    }
    const transferEncoding = headers['transfer-encoding'];
    if (
        (transferEncoding !== undefined && transferEncoding !== 'chunked') ||
        (transferEncoding !== undefined && rawLength !== undefined)
    )
        return { status: 400, message: 'Ambiguous request framing.' };
    if (request.method !== 'POST') {
        if (length !== 0 || transferEncoding !== undefined) return { status: 400, message: 'Unexpected request body.' };
        return undefined;
    }
    if (headers['content-encoding'] !== undefined && headers['content-encoding'] !== 'identity')
        return { status: 415, message: 'Unsupported request encoding.' };
    const contentType = headers['content-type'];
    if (
        typeof contentType !== 'string' ||
        !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType)
    )
        return { status: 415, message: 'A UTF-8 JSON request body is required.' };
    return undefined;
}

function registrationBearer(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value))
        throw new Error('A registration bearer is required.');
    return value;
}

export function parseRegisteredArguments(value: unknown) {
    if (!isRecord(value) || !Object.hasOwn(value, 'registrationBearer'))
        throw new Error('A registration bearer is required.');
    const bearer = registrationBearer(value.registrationBearer);
    const { registrationBearer: _bearer, ...arguments_ } = value;
    return { registrationBearer: bearer, arguments: arguments_ };
}

export function parseRegisteredOfficialArguments(value: unknown) {
    if (!isRecord(value) || !isRecord(value._dct)) throw new Error('An authenticated connection route is required.');
    const selected = parseRegisteredArguments(value._dct);
    const route = parseConnectionRoute(selected.arguments);
    const { _dct: _route, ...arguments_ } = value;
    return { registrationBearer: selected.registrationBearer, route, arguments: arguments_ };
}
