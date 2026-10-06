export interface SubmissionChecklist {
    label: string;
    selected: boolean;
    continuations: string[];
}

export interface SubmissionSection {
    heading: string | null;
    paragraphs: string[];
    checklists: SubmissionChecklist[];
}

export function normalizeSubmissionText(text: string) {
    return text.replace(/\s+/gu, ' ').trim();
}

/** Scan only submission structure and content; this is not a Markdown renderer. */
export function scanSubmissionMarkdown(source: string, { sectionLevel = 2 } = {}): SubmissionSection[] {
    let section: SubmissionSection = { heading: null, paragraphs: [], checklists: [] };
    const sections: SubmissionSection[] = [section];
    let paragraph: string[] = [];
    let paragraphIsProse = true;
    let checklist: SubmissionChecklist | undefined;
    let fence: { marker: string; length: number } | undefined;
    let inComment = false;
    const flushParagraph = () => {
        const text = paragraph.join('\n').trim();
        if (text) section.paragraphs.push(text);
        paragraph = [];
        paragraphIsProse = true;
    };
    const beginSection = (heading: string) => {
        section = { heading: normalizeSubmissionText(heading), paragraphs: [], checklists: [] };
        sections.push(section);
    };
    const visibleLine = (line: string) => {
        let visible = '';
        let remaining = line;
        while (remaining) {
            const marker = inComment ? '-->' : '<!--';
            const index = remaining.indexOf(marker);
            if (index < 0) {
                visible += inComment ? ' '.repeat(remaining.length) : remaining;
                break;
            }
            visible += inComment ? ' '.repeat(index) : remaining.slice(0, index);
            visible += ' '.repeat(marker.length);
            remaining = remaining.slice(index + marker.length);
            inComment = !inComment;
        }
        return visible;
    };
    for (const original of source.split(/\r?\n/u)) {
        if (fence) {
            const close = /^ {0,3}(`{3,}|~{3,})\s*$/u.exec(original);
            if (close?.[1]?.[0] === fence.marker && close[1].length >= fence.length) {
                flushParagraph();
                fence = undefined;
            } else {
                paragraph.push(original);
                paragraphIsProse = false;
            }
            continue;
        }
        const line = visibleLine(original);
        if (!line.trim()) {
            flushParagraph();
            checklist = undefined;
            continue;
        }
        const open = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
        if (open?.[1] && (open[1][0] === '~' || !open[2]?.includes('`'))) {
            flushParagraph();
            checklist = undefined;
            fence = { marker: open[1][0] ?? '', length: open[1].length };
            continue;
        }
        // Quotes and indented code provide evidence, never canonical structure.
        // Indented text directly after a checkbox can instead wrap its label.
        if (checklist && /^ {2,}\S/u.test(line) && !/^\s*(?:[-+*]|\d+[.)])\s/u.test(line)) {
            const continuation = line.trim();
            if (/^N\/A:/u.test(continuation) || checklist.continuations.length > 0) {
                checklist.continuations.push(continuation);
            } else {
                checklist.label = normalizeSubmissionText(`${checklist.label} ${continuation}`);
            }
            continue;
        }
        checklist = undefined;
        if (/^ {0,3}>/u.test(line)) {
            paragraph.push(line.replace(/^ {0,3}(?:>\s*)+/u, ''));
            paragraphIsProse = false;
            continue;
        }
        if (/^(?: {4}|\t)/u.test(line)) {
            paragraph.push(line.trim());
            paragraphIsProse = false;
            continue;
        }
        const setext = /^ {0,3}(=+|-+)\s*$/u.exec(line);
        if (setext?.[1] && paragraph.length > 0 && paragraphIsProse) {
            const title = paragraph.join('\n');
            paragraph = [];
            flushParagraph();
            if ((setext[1][0] === '=' ? 1 : 2) === sectionLevel) beginSection(title);
            continue;
        }
        if (/^ {0,3}(?:\*(?:\s*\*){2,}|-(?:\s*-){2,}|_(?:\s*_){2,})\s*$/u.test(line)) {
            flushParagraph();
            continue;
        }
        const heading = /^ {0,3}(#{1,6})(?:\s+|$)(.*?)\s*$/u.exec(line);
        if (heading?.[1]) {
            flushParagraph();
            if (heading[1].length === sectionLevel) {
                beginSection((heading[2] ?? '').replace(/\s+#+\s*$/u, ''));
            }
            continue;
        }
        const check = /^ {0,3}(?:[-+*]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/u.exec(line);
        if (check) {
            flushParagraph();
            checklist = {
                label: normalizeSubmissionText(check[2] ?? ''),
                selected: check[1] !== ' ',
                continuations: [],
            };
            section.checklists.push(checklist);
            continue;
        }
        paragraph.push(line);
        if (/^ {0,3}(?:[-+*]|\d+[.)])\s/u.test(line)) paragraphIsProse = false;
    }
    flushParagraph();
    return sections;
}
