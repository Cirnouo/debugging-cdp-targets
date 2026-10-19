/** Strict carrier validation against Chromium's native CommandLine parsing rules. */
export function effectiveChromeProfileArgument(arguments_: string[], platform: string): string | undefined {
    const windows = platform === 'win32';
    const whitespace = windows
        ? /^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g
        : /^[\t-\r ]+|[\t-\r ]+$/g;
    let directory: string | undefined;
    for (const argument of arguments_) {
        if (argument === '--') break;
        const native = argument.replace(whitespace, '');
        if (native === '--') throw new Error('Ambiguous Chrome switch terminator.');
        const prefix = native.startsWith('--')
            ? 2
            : native.startsWith('-') || (windows && native.startsWith('/'))
              ? 1
              : 0;
        if (!prefix) continue;
        const equals = native.indexOf('=');
        const originalKey = native.slice(prefix, equals === -1 ? undefined : equals);
        const key = windows ? originalKey.toLowerCase() : originalKey;
        if (windows && key === 'single-argument') throw new Error('Ambiguous Chrome single-argument parsing.');
        if (key !== 'user-data-dir' && !/^user-data-dir[\s:]/.test(key)) continue;
        if (
            directory !== undefined ||
            native !== argument ||
            !argument.startsWith('--user-data-dir=') ||
            key !== 'user-data-dir' ||
            equals === -1 ||
            equals === native.length - 1
        )
            throw new Error('Chrome requires one canonical --user-data-dir=value profile argument.');
        directory = native.slice(equals + 1);
    }
    return directory;
}
