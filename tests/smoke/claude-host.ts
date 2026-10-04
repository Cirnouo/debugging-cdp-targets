import assert from 'node:assert/strict';
import path from 'node:path';
export function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function claudeEnvironment(
    temporary: string,
    endpoint: string,
    parent: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
    const url = new URL(endpoint);
    assert.ok(
        url.protocol === 'http:' &&
            url.hostname === '127.0.0.1' &&
            url.port &&
            !url.username &&
            !url.password &&
            url.pathname === '/' &&
            !url.search &&
            !url.hash,
        'Synthetic provider must use an explicit loopback endpoint.',
    );
    assert.ok(path.isAbsolute(temporary));
    const environment: NodeJS.ProcessEnv = {};
    for (const key of [
        'PATH',
        'SystemRoot',
        'WINDIR',
        'COMSPEC',
        'PATHEXT',
        'ProgramFiles',
        'ProgramFiles(x86)',
        'PROCESSOR_ARCHITECTURE',
        'NUMBER_OF_PROCESSORS',
    ])
        if (parent[key]) environment[key] = parent[key];
    return Object.assign(environment, {
        HOME: path.join(temporary, 'home'),
        USERPROFILE: path.join(temporary, 'home'),
        APPDATA: path.join(temporary, 'appdata'),
        LOCALAPPDATA: path.join(temporary, 'localappdata'),
        TEMP: path.join(temporary, 'temp'),
        TMP: path.join(temporary, 'temp'),
        CLAUDE_CONFIG_DIR: path.join(temporary, 'config'),
        ANTHROPIC_API_KEY: 'sk-ant-synthetic-dct-smoke',
        ANTHROPIC_BASE_URL: url.origin,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        DISABLE_AUTOUPDATER: '1',
        DISABLE_TELEMETRY: '1',
        DISABLE_ERROR_REPORTING: '1',
        CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1',
        ENABLE_TOOL_SEARCH: 'false',
    });
}
export function claudeVersion(value: string): string {
    const match = /^(\d+)\.(\d+)\.(\d+) \(Claude Code\)\s*$/.exec(value);
    assert.ok(match, 'Expected an actual Claude Code version.');
    const major = Number(match[1]),
        minor = Number(match[2]),
        patch = Number(match[3]);
    assert.ok(
        major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 283))),
        'Claude Code 2.1.283 or newer is required.',
    );
    return `${major}.${minor}.${patch}`;
}
export interface ClaudeRequest {
    model: string;
    messages: Record<string, unknown>[];
    tools: Record<string, unknown>[];
}
export function claudeRequest(raw: string): ClaudeRequest {
    const value: unknown = JSON.parse(raw);
    assert.ok(
        record(value) && typeof value.model === 'string' && Array.isArray(value.messages) && Array.isArray(value.tools),
    );
    assert.ok(
        value.messages.every(
            (item: unknown) =>
                record(item) &&
                ['user', 'assistant'].includes(String(item.role)) &&
                (typeof item.content === 'string' ||
                    (Array.isArray(item.content) &&
                        item.content.every((part: unknown) => record(part) && typeof part.type === 'string'))),
        ),
    );
    assert.ok(
        value.tools.every(
            (tool: unknown) => record(tool) && typeof tool.name === 'string' && record(tool.input_schema),
        ),
    );
    const messages = value.messages.filter(record);
    const tools = value.tools.filter(record);
    return { ...value, model: value.model, messages, tools };
}
export function claudeToolResult(messages: Record<string, unknown>[], callId: string): Record<string, unknown> {
    for (const message of messages) {
        if (!Array.isArray(message.content)) continue;
        for (const item of message.content) {
            if (!record(item) || item.type !== 'tool_result' || item.tool_use_id !== callId) continue;
            assert.notEqual(item.is_error, true, 'Actual Claude tool result failed.');
            let content = item.content;
            if (Array.isArray(content)) {
                const text = content.find(
                    (part: unknown) => record(part) && part.type === 'text' && typeof part.text === 'string',
                );
                assert.ok(record(text));
                content = text.text;
            }
            assert.equal(typeof content, 'string');
            assert.ok(typeof content === 'string');
            const value: unknown = JSON.parse(content.split('\n\n<system-reminder>')[0] ?? '');
            assert.ok(record(value));
            return value;
        }
    }
    throw new Error(`Actual Claude model context omitted tool result ${callId}.`);
}
export type ClaudeBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
export function claudeSse(model: string, index: number, block: ClaudeBlock): string {
    const event = (type: string, data: Record<string, unknown>) =>
        `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    return [
        event('message_start', {
            message: {
                id: `msg_${index}`,
                type: 'message',
                role: 'assistant',
                model,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 0 },
            },
        }),
        event('content_block_start', {
            index: 0,
            content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' },
        }),
        event('content_block_delta', {
            index: 0,
            delta:
                block.type === 'tool_use'
                    ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
                    : { type: 'text_delta', text: block.text },
        }),
        event('content_block_stop', { index: 0 }),
        event('message_delta', {
            delta: { stop_reason: block.type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null },
            usage: { output_tokens: 3 },
        }),
        event('message_stop', {}),
    ].join('');
}

export function claudeContext(request: ClaudeRequest): string[] {
    return request.messages.flatMap((message) => {
        if (message.role !== 'user') return [];
        if (typeof message.content === 'string') return [message.content];
        if (!Array.isArray(message.content)) return [];
        return message.content.flatMap((part: unknown) => {
            if (!record(part)) return [];
            if (part.type === 'text' && typeof part.text === 'string') return [part.text];
            if (part.type !== 'tool_result') return [];
            if (typeof part.content === 'string')
                return [...part.content.matchAll(/<system-reminder>[\s\S]*?<\/system-reminder>/g)]
                    .map((match) => match[0])
                    .filter((text) => text.includes(' hook additional context: '));
            if (!Array.isArray(part.content)) return [];
            return part.content.flatMap((nested: unknown) =>
                record(nested) &&
                nested.type === 'text' &&
                typeof nested.text === 'string' &&
                nested.text.startsWith('<system-reminder>') &&
                nested.text.includes(' hook additional context: ')
                    ? [nested.text]
                    : [],
            );
        });
    });
}
