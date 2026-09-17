export function resolveStopTargetAction(targetInspection) {
    if (targetInspection?.status === 'absent') {
        return { action: 'remove-state', requireOwnedListener: false };
    }
    if (targetInspection?.status === 'valid') {
        return { action: 'manage-target', requireOwnedListener: true };
    }
    if (targetInspection?.processIdentityValid === true) {
        return { action: 'manage-target', requireOwnedListener: false };
    }
    return { action: 'reject', requireOwnedListener: false };
}

export async function classifySession({
    state,
    validateTarget = async () => false,
    validateDaemon = async () => false,
}) {
    if (!state) return { status: 'none', targetValid: false, daemonValid: false };
    const targetValid = Boolean(await validateTarget(state));
    const daemonValid = state.status === 'active' ? Boolean(await validateDaemon(state)) : false;
    if (state.status === 'active' && targetValid && daemonValid) return { status: 'active', targetValid, daemonValid };
    if (state.status === 'detached' && targetValid) return { status: 'detached', targetValid, daemonValid };
    return { status: 'stale', targetValid, daemonValid };
}

export function classifyInspectedSession({ state, targetInspection, daemonInspection }) {
    if (!state) return { status: 'none', targetValid: false, daemonValid: false };
    const targetValid = targetInspection?.status === 'valid';
    const daemonValid = daemonInspection?.status === 'valid';
    if (state.status === 'active' && targetValid && daemonValid) {
        return { status: 'active', targetValid, daemonValid };
    }
    if (state.status === 'detached' && targetValid && daemonInspection?.status === 'absent') {
        return { status: 'detached', targetValid, daemonValid: false };
    }
    return {
        status: 'stale',
        targetValid,
        daemonValid,
        targetReason: targetInspection?.reason,
        daemonReason: daemonInspection?.reason,
    };
}

export function canDiscardStaleState({ targetInspection, daemonInspection }) {
    return targetInspection?.status === 'absent' && daemonInspection?.status === 'absent';
}
