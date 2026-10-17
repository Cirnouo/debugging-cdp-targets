import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

/** Read-only SDK metadata from an already running App. This helper never starts the App or a target. */
export async function captureAppInitialization(file: string, url = 'http://127.0.0.1:27637/mcp') {
    const endpoint = new URL(url);
    assert.ok(
        endpoint.protocol === 'http:' &&
            endpoint.hostname === '127.0.0.1' &&
            endpoint.port &&
            endpoint.pathname === '/mcp' &&
            !endpoint.username &&
            !endpoint.password &&
            !endpoint.search &&
            !endpoint.hash,
    );
    const client = new Client({ name: 'independent-app-http-evidence', version: '0.1.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(endpoint);
    const methods: string[] = [];
    const send = transport.send.bind(transport);
    transport.send = async (message, options) => {
        if ('method' in message) methods.push(message.method);
        return send(message, options);
    };
    try {
        await client.connect(transport);
        const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
        await writeFile(
            file,
            `${JSON.stringify(
                {
                    capture: 'independent-sdk-http',
                    endpoint: endpoint.href,
                    methods,
                    result: {
                        serverInfo: client.getServerVersion(),
                        capabilities: client.getServerCapabilities(),
                        instructions: client.getInstructions(),
                    },
                    tools,
                },
                null,
                4,
            )}\n`,
        );
        return tools;
    } finally {
        await client.close();
    }
}
