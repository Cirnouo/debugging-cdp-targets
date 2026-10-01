import { createHash } from 'node:crypto';
import { chmod, lstat, unlink } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
    type ControlHandler,
    type ControlRequest,
    type ControlResponse,
    parseControlRequest,
    parseControlResponse,
} from '../domains/control-contract.ts';
import { CONTROL_TIMEOUT_MS, MAX_CONTROL_BYTES } from '../shared/constants.ts';
import { errorCode, errorDetails, errorMessage } from '../shared/errors.ts';

export function defaultControlEndpoint() {
    const user = os.userInfo();
    const identity = `${user.username}:${user.homedir}`;
    const suffix = createHash('sha256').update(identity).digest('hex').slice(0, 16);
    return process.platform === 'win32'
        ? `\\\\.\\pipe\\debugging-cdp-targets-${suffix}`
        : path.join(os.tmpdir(), `debugging-cdp-targets-${suffix}.sock`);
}

async function probeEndpoint(endpoint: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(endpoint);
        socket.setTimeout(1_000, () => socket.destroy(new Error('Control endpoint ownership is unverifiable.')));
        socket.once('connect', () => {
            socket.end();
            resolve('live');
        });
        socket.once('error', (error) => {
            if (errorCode(error) === 'ECONNREFUSED') resolve('refused');
            else reject(error);
        });
    });
}

type SocketIdentity = { uid: number; ino: number; dev: number; ctimeMs: number; isSocket(): boolean };
type RecoveryIo = {
    platform?: string;
    uid?: number;
    inspect?: (endpoint: string) => Promise<SocketIdentity>;
    probe?: (endpoint: string) => Promise<string>;
    remove?: (endpoint: string) => Promise<void>;
};
export async function recoverStaleEndpoint(endpoint: string, io: RecoveryIo = {}) {
    const platform = io.platform ?? process.platform;
    if (platform === 'win32') return;
    const inspect = io.inspect ?? lstat;
    const probe = io.probe ?? probeEndpoint;
    const remove = io.remove ?? unlink;
    const uid = io.uid ?? process.getuid?.();
    let before: SocketIdentity;
    try {
        before = await inspect(endpoint);
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return;
        throw error;
    }
    if (!before.isSocket() || before.uid !== uid) throw new Error('The control endpoint is not an owned Unix socket.');
    if ((await probe(endpoint)) !== 'refused')
        throw new Error('A debugging-cdp-targets MCP connection is already active for this user.');
    const after = await inspect(endpoint);
    if (before.ino !== after.ino || before.dev !== after.dev || before.ctimeMs !== after.ctimeMs)
        throw new Error('The control endpoint identity changed during recovery.');
    await remove(endpoint);
}

async function dispatch(controller: ControlHandler, request: ControlRequest) {
    switch (request?.action) {
        case 'status':
            return controller.status();
        case 'start':
            return controller.start({
                launchCommand: request.launchCommand,
                ...(request.targetKind === undefined ? {} : { targetKind: request.targetKind }),
                ...(request.basePort === undefined ? {} : { basePort: request.basePort }),
            });
        case 'switch':
            return controller.switch({
                launchCommand: request.launchCommand,
                disposition: request.disposition,
                ...(request.targetKind === undefined ? {} : { targetKind: request.targetKind }),
                ...(request.basePort === undefined ? {} : { basePort: request.basePort }),
            });
        case 'stop':
            return controller.stop({ disposition: request.disposition });
        default:
            throw new Error('Unknown control action. Use status, start, switch, or stop.');
    }
}

export async function createControlServer({
    controller,
    endpoint = defaultControlEndpoint(),
}: {
    controller: ControlHandler;
    endpoint?: string;
}) {
    await recoverStaleEndpoint(endpoint);
    let operation = Promise.resolve();
    const server = net.createServer((socket) => {
        let received = '';
        let submitted = false;
        socket.on('error', () => {});
        socket.setTimeout(CONTROL_TIMEOUT_MS, () => socket.destroy());
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => {
            if (submitted) return;
            received += chunk;
            if (Buffer.byteLength(received) > MAX_CONTROL_BYTES) {
                submitted = true;
                socket.end(JSON.stringify({ ok: false, error: 'Control request is too large.' }));
                return;
            }
            if (!received.includes('\n')) return;
            submitted = true;
            const line = received.slice(0, received.indexOf('\n'));
            received = '';
            operation = operation
                .catch(() => {})
                .then(async () => {
                    try {
                        const raw: unknown = JSON.parse(line);
                        const result = await dispatch(controller, parseControlRequest(raw));
                        socket.end(`${JSON.stringify({ ok: true, result })}\n`);
                    } catch (error) {
                        socket.end(
                            `${JSON.stringify({ ok: false, error: errorMessage(error), ...(errorDetails(error) ? { details: errorDetails(error) } : {}) })}\n`,
                        );
                    }
                });
        });
    });
    const previousMask = process.platform === 'win32' ? undefined : process.umask(0o077);
    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen({ path: endpoint, readableAll: false, writableAll: false }, resolve);
        });
    } finally {
        if (previousMask !== undefined) process.umask(previousMask);
    }
    if (process.platform !== 'win32') await chmod(endpoint, 0o600);
    return {
        endpoint,
        async close() {
            await new Promise<void>((resolve) => server.close(() => resolve()));
            if (process.platform !== 'win32')
                await unlink(endpoint).catch((error) => {
                    if (errorCode(error) !== 'ENOENT') throw error;
                });
        },
    };
}

export async function sendControlRequest(endpoint: string, request: unknown): Promise<ControlResponse> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(endpoint);
        let received = '';
        socket.setEncoding('utf8');
        socket.setTimeout(CONTROL_TIMEOUT_MS, () => socket.destroy(new Error('Control request timed out.')));
        socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
        socket.on('data', (chunk) => {
            received += chunk;
        });
        socket.once('end', () => {
            try {
                const raw: unknown = JSON.parse(received.trim());
                resolve(parseControlResponse(raw));
            } catch (error) {
                reject(error);
            }
        });
        socket.once('error', reject);
    });
}
