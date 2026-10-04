/** Bounded metadata only: no arguments, environment, URLs, page data or payloads. */
export type Diagnostic = {
    phase:
        | 'connection-health'
        | 'identity-check'
        | 'discovery-response'
        | 'cdp-connect'
        | 'cdp-response'
        | 'cdp-screenshot'
        | 'upstream-processing'
        | 'result-ready';
    outcome: 'completed' | 'failed' | 'interrupted';
    elapsedMs: number;
};
export type Diagnose = (event: Diagnostic) => void;

export function measured(diagnose: Diagnose | undefined, phase: Diagnostic['phase']) {
    const started = performance.now();
    let finished = false;
    return (outcome: Diagnostic['outcome'] = 'completed') => {
        if (finished) return;
        finished = true;
        diagnose?.({ phase, outcome, elapsedMs: Math.round((performance.now() - started) * 100) / 100 });
    };
}
