export const GUI_SKIP_REASON = 'GUI execution requires explicit --allow-gui authorization.';

export function guiAuthorization(args: readonly string[] = process.argv.slice(2)) {
    return {
        allowed: args.includes('--allow-gui'),
        args: args.filter((argument) => argument !== '--allow-gui'),
    };
}

export function requireGuiAuthorization(args: readonly string[] = process.argv.slice(2)): string[] {
    const authorization = guiAuthorization(args);
    if (!authorization.allowed) {
        console.log(`SKIP: ${GUI_SKIP_REASON}`);
        process.exit(0);
    }
    return authorization.args;
}

export function guiMutationArguments(state: string, args: readonly string[] = process.argv.slice(2)): string[] {
    return state !== 'None' && guiAuthorization(args).allowed ? ['-AllowGui'] : [];
}
