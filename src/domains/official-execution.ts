import { isRecord } from '../shared/errors.ts';

/** One actual request identity. A client wait or SDK timeout cannot settle it. */
export function createOfficialExecution() {
    let id: string | number | undefined;
    let settled = false;
    let resolve = () => {};
    const terminal = new Promise<void>((done) => {
        resolve = done;
    });
    function finish() {
        if (settled) return false;
        settled = true;
        resolve();
        return true;
    }
    return {
        get id() {
            return id;
        },
        get settled() {
            return settled;
        },
        terminal,
        assign(value: string | number) {
            if (id !== undefined) throw new Error('The official execution is already bound to a wire request.');
            id = value;
        },
        observe(message: unknown) {
            if (
                !isRecord(message) ||
                id === undefined ||
                message.id !== id ||
                'method' in message ||
                Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error')
            )
                return false;
            return finish();
        },
        finish,
    };
}
