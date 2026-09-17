export class SessionError extends Error {
    constructor(code, message, details = undefined) {
        super(message);
        this.name = 'SessionError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

export function fail(code, message, details) {
    throw new SessionError(code, message, details);
}
