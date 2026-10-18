import type { SyncRule } from '@commitlint/types';

const genericTrailer = /^([\w-]+)(?::\s+\S|\s+#\S)/;
const breakingTrailer = /^(?:\*\s+)?BREAKING[ -]CHANGE:/i;
const closingTrailer = /^(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?):?\s+(?:[\w.-]+\/[\w.-]+)?#\d+(?=\s|$|[,;.)\]])/i;

// Enforce the repository's configured `always` policy using original line boundaries.
export const footerLeadingBlank: SyncRule = (parsed) => {
    if (typeof parsed.raw !== 'string') return [false, 'raw commit message is required'];
    const lines = parsed.raw.split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => line.trim().length > 0);
    let afterHeader = true;
    let precedingBlank = false;
    let footerStarted = false;

    for (const line of lines.slice(headerIndex + 1)) {
        if (line.trim().length === 0) {
            precedingBlank = true;
            continue;
        }
        if (afterHeader && !precedingBlank) return [false, 'body or footer must have leading blank line'];
        afterHeader = false;

        const token = genericTrailer.exec(line)?.[1];
        const explicitFooter =
            breakingTrailer.test(line) ||
            closingTrailer.test(line) ||
            (token !== undefined && (token.toLowerCase() === 'refs' || token.includes('-')));
        if (!footerStarted && explicitFooter && !precedingBlank) {
            return [false, 'footer must have leading blank line'];
        }
        if (precedingBlank && (explicitFooter || token !== undefined)) footerStarted = true;
        precedingBlank = false;
    }
    return [true];
};
