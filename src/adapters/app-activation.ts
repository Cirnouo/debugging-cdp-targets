import { chmod, lstat, unlink } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { errorCode } from '../shared/errors.ts';

const ACTIVATION = 'activate-v1\n';
const ACKNOWLEDGEMENT = 'activated-v1\n';
const ACTIVATION_TIMEOUT_MS = 1500;

export async function listenForAppActivation(options: {
    ownsSingleton: boolean;
    endpoint: string;
    activate: () => void;
}) {
    if (options.ownsSingleton !== true) throw new Error('Only the singleton owner can create an activation listener.');
    if (process.platform !== 'win32') {
        try {
            const previous = await lstat(options.endpoint);
            if (!previous.isSocket()) throw new Error('Activation endpoint is not a socket.');
            await unlink(options.endpoint);
        } catch (error) {
            if (errorCode(error) !== 'ENOENT') throw error;
        }
    }
    const server = createServer((socket) => {
        socket.setTimeout(ACTIVATION_TIMEOUT_MS, () => socket.destroy());
        socket.on('error', () => {});
        let request = '';
        socket.on('data', (chunk: Buffer) => {
            request += chunk.toString('utf8');
            if (request.length > ACTIVATION.length || !ACTIVATION.startsWith(request)) {
                socket.destroy();
                return;
            }
            if (request !== ACTIVATION) return;
            socket.removeAllListeners('data');
            try {
                options.activate();
                socket.end(ACKNOWLEDGEMENT);
                socket.destroySoon();
            } catch {
                socket.destroy();
            }
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen({ path: options.endpoint, readableAll: false, writableAll: false }, () => {
            server.removeListener('error', reject);
            resolve();
        });
    });
    if (process.platform !== 'win32') await chmod(options.endpoint, 0o600);
    return {
        close: () =>
            new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    };
}

export function activateExistingApp(endpoint: string): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = connect(endpoint, () => socket.write(ACTIVATION));
        let reply = '';
        let settled = false;
        const finish = (activated: boolean) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(activated);
        };
        socket.setTimeout(ACTIVATION_TIMEOUT_MS, () => finish(false));
        socket.on('error', () => finish(false));
        socket.on('close', () => finish(reply === ACKNOWLEDGEMENT));
        socket.on('data', (chunk: Buffer) => {
            reply += chunk.toString('utf8');
            if (reply.length > ACKNOWLEDGEMENT.length || !ACKNOWLEDGEMENT.startsWith(reply)) finish(false);
            else if (reply === ACKNOWLEDGEMENT) finish(true);
        });
    });
}
