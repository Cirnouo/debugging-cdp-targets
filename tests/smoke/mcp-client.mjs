import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function createClient(entry, options = {}) {
    const child = spawn(process.execPath, [entry], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        ...options,
    });
    const pending = new Map();
    let id = 0;
    let stderr = '';
    child.stderr.on('data', (data) => {
        stderr += data;
    });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
        let message;
        try {
            message = JSON.parse(line);
        } catch {
            throw new Error(`Non-MCP stdout: ${line.slice(0, 100)}`);
        }
        if (!pending.has(message.id)) return;
        const request = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(request.timeout);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
    });
    child.once('exit', () => {
        for (const { reject, timeout } of pending.values()) {
            clearTimeout(timeout);
            reject(new Error(stderr));
        }
        pending.clear();
    });
    return {
        child,
        request(method, params = {}) {
            id += 1;
            const current = id;
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    pending.delete(current);
                    reject(new Error(`MCP timeout: ${method}: ${stderr}`));
                }, 60_000);
                pending.set(current, { resolve, reject, timeout });
                child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: current, method, params })}\n`);
            });
        },
        notify(method) {
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
        },
        async close() {
            const closed = new Promise((resolve) => child.once('exit', resolve));
            child.stdin.end();
            await closed;
            lines.close();
        },
    };
}
