const EXPLANATIONS = Object.freeze({
    APP_CLOSING: 'The App is closing. Wait for normal cleanup to finish before reconnecting.',
    CONNECTION_BUSY:
        'The connection is busy with an owned official execution or lifecycle operation. Wait for that work to settle before retrying.',
    CLIENT_CONTEXT_UNAVAILABLE:
        'The originating client request context is unavailable. Reconnect and issue a new request through an available client.',
    ROOTS_UNAVAILABLE:
        'The originating client roots reader is unavailable. Use a client with an available roots facility.',
    FORM_ELICITATION_UNAVAILABLE:
        'The originating client does not support form-mode elicitation. Use a client with form-mode elicitation for this operation.',
});

/** Closed, path-free explanations for failures that authenticated clients can act on. */
export class RequestFailure extends Error {
    readonly code: keyof typeof EXPLANATIONS;

    constructor(code: keyof typeof EXPLANATIONS) {
        super(EXPLANATIONS[code]);
        this.code = code;
    }
}

export function requestFailureExplanation(error: RequestFailure) {
    return EXPLANATIONS[error.code];
}
