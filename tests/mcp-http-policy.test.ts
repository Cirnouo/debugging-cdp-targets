import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MCP_MAX_REQUEST_BODY_BYTES, mcpHttpRejection } from '../src/domains/mcp-http.ts';

const headers = { host: '127.0.0.1:27637', 'content-type': 'application/json' };
const request = { method: 'POST', url: '/mcp', headers };

test('HTTP admission uses the exact effective loopback authority, origin, path and methods', () => {
    for (const method of ['POST', 'GET', 'DELETE'])
        assert.equal(mcpHttpRejection({ ...request, method }, 27637), undefined);
    assert.equal(
        mcpHttpRejection({ ...request, headers: { ...headers, origin: 'http://127.0.0.1:27637' } }, 27637),
        undefined,
    );
    for (const host of [undefined, ['127.0.0.1:27637'], 'localhost:27637', '127.0.0.1:29111', 'attacker.invalid']) {
        const result = mcpHttpRejection(
            { ...request, headers: { ...headers, host, 'x-forwarded-host': headers.host } },
            27637,
        );
        assert.equal(result?.status, 403);
        assert.equal(JSON.stringify(result).includes('attacker.invalid'), false);
    }
    for (const origin of ['null', ['http://127.0.0.1:27637'], 'http://127.0.0.1:29111', 'https://127.0.0.1:27637'])
        assert.equal(mcpHttpRejection({ ...request, headers: { ...headers, origin } }, 27637)?.status, 403);
    for (const url of ['/mcp?token=private', '/mcp/', 'http://127.0.0.1:27637/mcp', '/other'])
        assert.equal(mcpHttpRejection({ ...request, url }, 27637)?.status, 404);
    for (const method of ['OPTIONS', 'PUT', 'PATCH'])
        assert.equal(mcpHttpRejection({ ...request, method }, 27637)?.status, 405);
    assert.equal(mcpHttpRejection({ ...request, headers: { ...headers, host: '127.0.0.1:29111' } }, 29111), undefined);
});

test('HTTP admission refuses oversized, ambiguous and unsupported body headers before protocol handling', () => {
    for (const type of [
        undefined,
        ['application/json'],
        'text/plain',
        'application/jsonp',
        'application/json; charset=utf-16',
    ])
        assert.equal(
            mcpHttpRejection({ ...request, headers: { ...headers, 'content-type': type } }, 27637)?.status,
            415,
        );
    assert.equal(
        mcpHttpRejection(
            { ...request, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } },
            27637,
        ),
        undefined,
    );
    for (const length of ['-1', '1.5', ['3'], ' 3', '03', '9007199254740992'])
        assert.equal(
            mcpHttpRejection({ ...request, headers: { ...headers, 'content-length': length } }, 27637)?.status,
            400,
        );
    assert.equal(
        mcpHttpRejection(
            { ...request, headers: { ...headers, 'content-length': String(MCP_MAX_REQUEST_BODY_BYTES + 1) } },
            27637,
        )?.status,
        413,
    );
    assert.equal(
        mcpHttpRejection({ ...request, headers: { ...headers, 'content-encoding': 'gzip' } }, 27637)?.status,
        415,
    );
    assert.equal(
        mcpHttpRejection({ ...request, headers: { ...headers, 'transfer-encoding': 'chunked' } }, 27637),
        undefined,
    );
    for (const framing of [
        { 'transfer-encoding': 'chunked', 'content-length': '3' },
        { 'transfer-encoding': ['chunked'] },
        { 'transfer-encoding': 'gzip, chunked' },
    ])
        assert.equal(mcpHttpRejection({ ...request, headers: { ...headers, ...framing } }, 27637)?.status, 400);
    assert.equal(
        mcpHttpRejection({ ...request, method: 'GET', headers: { ...headers, 'content-length': '1' } }, 27637)?.status,
        400,
    );
});
