import { normalizeSubmissionText, scanSubmissionMarkdown } from './submission-markdown.ts';

export function validatePullRequestBody(body: string | null, template: string): string[] {
    const expected = scanSubmissionMarkdown(template).filter((section) => section.heading !== null);
    if (expected.length === 0) throw new Error('The current pull request template has no H2 sections.');
    const scanned = scanSubmissionMarkdown(body ?? '');
    const actual = scanned.filter((section) => section.heading !== null);
    const placeholders = expected.flatMap((section) => section.paragraphs).map(normalizeSubmissionText);
    const errors: string[] = [];
    if (
        expected.length !== actual.length ||
        expected.some((section, index) => section.heading !== actual[index]?.heading)
    ) {
        errors.push('Pull request body must preserve every template H2 section exactly once and in order.');
    }
    for (const section of expected) {
        const matches = actual.filter((candidate) => candidate.heading === section.heading);
        if (matches.length !== 1) continue;
        const candidate = matches[0];
        if (!candidate) continue;
        const canonicalLabels = section.checklists.map((check) => check.label);
        const matchedLabels = candidate.checklists
            .filter((check) => canonicalLabels.includes(check.label))
            .map((check) => check.label);
        if (
            matchedLabels.length !== canonicalLabels.length ||
            canonicalLabels.some((label, index) => matchedLabels[index] !== label)
        ) {
            errors.push(`Pull request body: ${section.heading} must preserve its template checklists once in order.`);
        }
        for (const check of section.checklists) {
            const allOccurrences = scanned
                .flatMap((entry) => entry.checklists)
                .filter((item) => item.label === check.label);
            const occurrences = candidate.checklists.filter((item) => item.label === check.label);
            if (allOccurrences.length !== 1 || occurrences.length !== 1) {
                errors.push(`Pull request body: checklist must occur once in ${section.heading}: ${check.label}`);
                continue;
            }
            const item = occurrences[0];
            if (!item || item.selected) continue;
            const conditional = check.label.includes('when applicable');
            const reason = item.continuations[0];
            if (!conditional || !reason || !/^N\/A:\s*\S/u.test(reason)) {
                errors.push(
                    `Pull request body: checklist must be selected${conditional ? ' or have an adjacent indented N/A: reason' : ''}: ${check.label}`,
                );
            }
        }
        // Template prose identifies sections that need an answer. Rescan only
        // their content to discard quoted/code examples consisting of headings,
        // checkboxes or starter prose, without making those examples structural.
        const content = candidate.paragraphs.flatMap((paragraph) =>
            scanSubmissionMarkdown(paragraph).flatMap((entry) => entry.paragraphs),
        );
        if (
            section.paragraphs.length > 0 &&
            !content.some((paragraph) => !placeholders.includes(normalizeSubmissionText(paragraph)))
        ) {
            errors.push(
                `Pull request body: ${section.heading} needs content or evidence beyond template starter prose.`,
            );
        }
    }
    return errors;
}
