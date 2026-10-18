import { isDeepStrictEqual } from 'node:util';
import {
    OWN_PLUGIN,
    type PluginHost,
    pluginManifestPath,
    pluginMcpPath,
    validateAppEndpoint,
} from '../domains/host-management.ts';
import { isRecord } from '../shared/errors.ts';

export type PluginPayloadFiles = ReadonlyMap<string, Buffer>;

function jsonObject(bytes: Buffer | undefined): Record<string, unknown> {
    if (!bytes) throw new Error('invalid-payload-layout');
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(value)) throw new Error('invalid-payload-json');
    return value;
}

function ownServer(document: Record<string, unknown>, host: PluginHost): Record<string, unknown> {
    if (!isRecord(document.mcpServers) || !isRecord(document.mcpServers['cdp-targets']))
        throw new Error('invalid-payload-transport');
    const server = document.mcpServers['cdp-targets'];
    if (
        server.type !== (host === 'codex' ? 'streamable-http' : 'http') ||
        typeof server.url !== 'string' ||
        ['command', 'args', 'cwd'].some((key) => Object.hasOwn(server, key))
    )
        throw new Error('invalid-payload-transport');
    validateAppEndpoint(server.url);
    return server;
}

/** Let JSON.parse identify the unique own-value literal; no headers or full JSON enter the receipt. */
export function pluginMcpEndpointEvidence(bytes: Buffer, host: PluginHost): { endpoint: string; byteOffset: number } {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes)) throw new Error('invalid-payload-json');
    const document = jsonObject(bytes);
    const server = ownServer(document, host);
    const endpoint = server.url;
    if (typeof endpoint !== 'string') throw new Error('invalid-payload-transport');
    const original = Buffer.from(JSON.stringify(endpoint));
    server.url = endpoint === 'http://127.0.0.1:1/mcp' ? 'http://127.0.0.1:2/mcp' : 'http://127.0.0.1:1/mcp';
    const replacement = Buffer.from(JSON.stringify(server.url));
    let result: number | undefined;
    let candidates = 0;
    for (
        let offset = bytes.indexOf(original);
        offset !== -1;
        offset = bytes.indexOf(original, offset + original.length)
    ) {
        if (++candidates > 64) throw new Error('ambiguous-payload-overlay');
        const candidate = Buffer.concat([
            bytes.subarray(0, offset),
            replacement,
            bytes.subarray(offset + original.length),
        ]);
        let parsed: unknown;
        try {
            parsed = JSON.parse(candidate.toString('utf8'));
        } catch {
            continue;
        }
        if (!isDeepStrictEqual(document, parsed)) continue;
        if (result !== undefined) throw new Error('ambiguous-payload-overlay');
        result = offset;
    }
    if (result === undefined) throw new Error('invalid-payload-overlay');
    return { endpoint, byteOffset: result };
}

/** Only the proved own string literal may differ from immutable source bytes. */
export function overlayPluginEndpoint(bytes: Buffer, host: PluginHost, endpoint: string, byteOffset?: number): Buffer {
    validateAppEndpoint(endpoint);
    const original = pluginMcpEndpointEvidence(bytes, host);
    if (byteOffset !== undefined && original.byteOffset !== byteOffset) throw new Error('mismatched-payload-overlay');
    if (original.endpoint === endpoint) return bytes;
    return Buffer.concat([
        bytes.subarray(0, original.byteOffset),
        Buffer.from(JSON.stringify(endpoint)),
        bytes.subarray(original.byteOffset + Buffer.byteLength(JSON.stringify(original.endpoint))),
    ]);
}

export function verifyPluginPayload(
    host: PluginHost,
    version: string,
    expected: PluginPayloadFiles,
    actual: PluginPayloadFiles,
    overlay = true,
) {
    const manifest = jsonObject(actual.get(pluginManifestPath(host)));
    const sourceManifest = jsonObject(expected.get(pluginManifestPath(host)));
    if (
        manifest.name !== OWN_PLUGIN ||
        manifest.version !== version ||
        sourceManifest.name !== OWN_PLUGIN ||
        sourceManifest.version !== version
    )
        throw new Error('invalid-payload-manifest');
    if (actual.size !== expected.size) throw new Error('mismatched-payload-files');
    for (const [name, bytes] of expected) {
        const observed = actual.get(name);
        if (!observed) throw new Error('mismatched-payload-files');
        if (name !== pluginMcpPath(host) || !overlay) {
            if (!bytes.equals(observed)) throw new Error('mismatched-payload-bytes');
        } else {
            const current = jsonObject(observed);
            const endpoint = ownServer(current, host).url;
            if (typeof endpoint !== 'string' || !overlayPluginEndpoint(bytes, host, endpoint).equals(observed))
                throw new Error('mismatched-payload-overlay');
        }
    }
    const mcp = actual.get(pluginMcpPath(host));
    if (!mcp) throw new Error('invalid-payload-layout');
    pluginMcpEndpointEvidence(mcp, host);
}
