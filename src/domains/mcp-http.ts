export const MCP_MAX_REQUEST_BODY_BYTES = 1024 * 1024;
type HttpRequestEvidence = Readonly<{
    method: string | undefined;
    url: string | undefined;
    headers: Readonly<Record<string, unknown>>;
}>;
type HttpRejection = Readonly<{ status: 400 | 403 | 404 | 405 | 413 | 415; message: string }>;

/** Called only with parsed JSON; walk one member at a time without recursive or wide child collections. */
export function mcpJsonRejection(value: unknown): HttpRejection | undefined {
    function* children(container: object): Generator<unknown> {
        if (Array.isArray(container)) {
            for (let index = 0; index < container.length; index++) yield container[index];
        } else {
            for (const key in container)
                if (Object.hasOwn(container, key)) yield (container as Record<string, unknown>)[key];
        }
    }
    const stack: Iterator<unknown>[] = [];
    if (value !== null && typeof value === 'object') stack.push(children(value));
    let members = 0;
    while (stack.length > 0) {
        const next = stack[stack.length - 1]?.next();
        if (!next || next.done) {
            stack.pop();
            continue;
        }
        members++;
        if (members > 10000) return { status: 413, message: 'Request JSON exceeds the structural limit.' };
        if (next.value !== null && typeof next.value === 'object') {
            if (stack.length >= 64) return { status: 413, message: 'Request JSON exceeds the structural limit.' };
            stack.push(children(next.value));
        }
    }
    return undefined;
}

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
