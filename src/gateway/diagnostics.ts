import type { Diagnose, Diagnostic } from '../domains/control-contract.ts';

export function measured(diagnose: Diagnose | undefined, phase: Diagnostic['phase']) {
    const started = performance.now();
    let finished = false;
    return (outcome: Diagnostic['outcome'] = 'completed') => {
        if (finished) return;
        finished = true;
        diagnose?.({ phase, outcome, elapsedMs: Math.round((performance.now() - started) * 100) / 100 });
    };
}
