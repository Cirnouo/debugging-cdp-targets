const screenshotFeature = 'CDPScreenshotNewSurface';

function trimWindowsArgument(value: string) {
    // Chromium 154 Windows kWhitespaceUTF16 includes NEL and excludes FEFF.
    return value.replace(
        /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g,
        '',
    );
}

function namesScreenshotFeature(entry: string) {
    const name = entry.trim().replace(/^\*/, '').split(/[<:.]/, 1)[0]?.trim();
    return name === screenshotFeature;
}

function validateEnableFeatureEntry(entry: string) {
    // Values are ASCII here. Chromium discards blank comma entries, then splits
    // the remaining prefix in this order before assigning the whole enable list.
    let prefix = entry.trim();
    if (prefix.length === 0) return;
    for (const separator of [':', '.', '<']) {
        const parts = prefix.split(separator);
        if (prefix.length === 0 || parts.length > 2)
            throw new Error(
                'Chrome enable feature list is malformed; repair the ordered feature, trial, group and parameter separators.',
            );
        prefix = parts[0]?.trim() ?? '';
    }
}

export function withChromeScreenshotFeature(arguments_: readonly string[]): string[] {
    const separator = arguments_.indexOf('--');
    const end = separator < 0 ? arguments_.length : separator;
    const switches = new Set<string>();
    let enableIndex: number | undefined;
    let enableValue = '';
    let occurrences = 0;
    for (let index = 0; index < end; index += 1) {
        const argument = arguments_[index];
        if (argument === undefined) throw new Error('Missing Chrome launch argument.');
        const trimmed = trimWindowsArgument(argument);
        if (trimmed === '--')
            throw new Error('Chrome trims argument whitespace; use an exact -- terminator before positional args.');
        // Case variants are conservatively refused even though Windows' special
        // raw-command-line boundary recognizes only the lowercase key.
        if (/^[-/]+\s*single-argument(?:[=:\s]|$)/i.test(trimmed))
            throw new Error('Remove the single-argument switch so the fixed Chrome screenshot feature can apply.');
        if (!/^[-/]+\s*(?:enable|disable)-features(?:[=:\s]|$)/i.test(trimmed)) continue;
        const canonical = argument.match(/^--(enable|disable)-features=([\s\S]*)$/);
        if (argument !== trimmed || !canonical)
            throw new Error(
                'Chrome feature switches are ambiguous; use one canonical --enable-features= or --disable-features= token.',
            );
        const name = canonical[1];
        const value = canonical[2];
        if (name === undefined || value === undefined) throw new Error('Invalid Chrome feature switch.');
        if (switches.has(name))
            throw new Error(
                'Duplicate Chrome feature switches are ambiguous; combine each list in one canonical token.',
            );
        switches.add(name);
        if (/[^\x00-\x7f]/.test(value))
            throw new Error('Chrome feature values must be ASCII; use valid ASCII feature names and parameter values.');
        if (name === 'enable') {
            enableIndex = index;
            enableValue = value;
        }
        for (const entry of value.split(',')) {
            if (name === 'enable') validateEnableFeatureEntry(entry);
            if (!namesScreenshotFeature(entry)) continue;
            if (name === 'disable')
                throw new Error(
                    'CDPScreenshotNewSurface disable conflicts with fixed Windows Chrome screenshots; remove the target from --disable-features.',
                );
            if (entry !== screenshotFeature)
                throw new Error(
                    'CDPScreenshotNewSurface must be one bare feature; remove whitespace, default, trial, group and parameter decorations.',
                );
            occurrences += 1;
            if (occurrences > 1)
                throw new Error(
                    'CDPScreenshotNewSurface has duplicate entries; retain exactly one bare enabled feature.',
                );
        }
    }
    const result = [...arguments_];
    if (occurrences === 1) return result;
    if (enableIndex === undefined) result.splice(end, 0, `--enable-features=${screenshotFeature}`);
    else result[enableIndex] = `--enable-features=${enableValue}${enableValue ? ',' : ''}${screenshotFeature}`;
    return result;
}
