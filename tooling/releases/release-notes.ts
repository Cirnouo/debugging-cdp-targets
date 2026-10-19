interface MarkdownLine {
    text: string;
    plain: boolean;
    heading?: { level: number; text: string };
}

function markdownLines(source: string): MarkdownLine[] {
    let fence: { character: string; length: number } | undefined;
    return source.split(/\r?\n/).map((text): MarkdownLine => {
        if (fence) {
            if (new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`).test(text)) fence = undefined;
            return { text, plain: false };
        }
        const opening = text.match(/^ {0,3}(`{3,}|~{3,})/);
        if (opening?.[1]) {
            fence = { character: opening[1].charAt(0), length: opening[1].length };
            return { text, plain: false };
        }
        const heading = text.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/);
        return {
            text,
            plain: true,
            ...(heading?.[1] && heading[2] !== undefined
                ? { heading: { level: heading[1].length, text: heading[2].replace(/\s+#+\s*$/, '').trim() } }
                : {}),
        };
    });
}

function sectionEnd(lines: MarkdownLine[], start: number) {
    const next = lines.findIndex((line, index) => index > start && line.heading?.level === 2);
    return next < 0 ? lines.length : next;
}

export function extractChangelog(source: string, version: string) {
    const lines = markdownLines(source);
    const matches = lines.flatMap((line, index) => {
        const match = line.heading?.level === 2 ? line.heading.text.match(/^\[([^\]]+)\](.*)$/) : null;
        return match?.[1] === version ? [{ index, suffix: match[2] ?? '' }] : [];
    });
    const entry = matches[0];
    if (matches.length !== 1 || !entry)
        throw new Error('Changelog requires exactly one entry for the release version.');
    const date = entry.suffix.match(/^ - (\d{4}-\d{2}-\d{2})$/)?.[1];
    const timestamp = date ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
    if (!date || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
        throw new Error('Changelog release entry requires a valid ISO calendar date.');
    }
    const contents = lines.slice(entry.index + 1, sectionEnd(lines, entry.index));
    if (!contents.some((line) => line.plain && /^\s*[-*+]\s+\S/.test(line.text))) {
        throw new Error('Changelog release entry must contain nonempty changes.');
    }
    return contents
        .map((line) => line.text)
        .join('\n')
        .trim();
}

function newContributors(source: string) {
    const lines = markdownLines(source);
    const start = lines.findIndex((line) => line.heading?.level === 2 && line.heading.text === 'New Contributors');
    if (start < 0) return '';
    const contents = lines.slice(start + 1, sectionEnd(lines, start));
    const fullChangelog = contents.findIndex((line) => line.plain && /^\*\*Full Changelog\*\*:/.test(line.text));
    const contributors = fullChangelog < 0 ? contents : contents.slice(0, fullChangelog);
    if (!contributors.some((line) => line.plain && /^\s*[-*+]\s+@\S+/.test(line.text))) return '';
    return contributors
        .map((line) => line.text)
        .join('\n')
        .trim();
}

export function buildReleaseBody(
    changes: string,
    tag: string,
    generated: string,
    repository: string,
    previousTag?: string,
) {
    const contributors = newContributors(generated);
    const current = encodeURIComponent(tag);
    const history = previousTag
        ? `https://github.com/${repository}/compare/${encodeURIComponent(previousTag)}...${current}`
        : `https://github.com/${repository}/commits/${current}`;
    const sections = [
        `## What's Changed\n\n${changes}`,
        ...(contributors ? [`## New Contributors\n\n${contributors}`] : []),
        `**Full Changelog**: ${history}`,
    ];
    return `${sections.join('\n\n')}\n`;
}
