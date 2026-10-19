import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGitHubIssueRequest, IssueAutomationError } from './github-issues.ts';
import { issueFeedbackContext, runIssueFeedback } from './issue-feedback.ts';

async function main() {
    if (process.argv.length !== 2 || !process.env.GITHUB_EVENT_PATH || !process.env.GH_TOKEN)
        throw new IssueAutomationError('Issue feedback requires its GitHub Actions event and built-in token.');
    const event: unknown = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const context = issueFeedbackContext(process.env, event);
    const forms = {
        bugReport: await readFile(new URL('../../.github/ISSUE_TEMPLATE/bug_report.yaml', import.meta.url), 'utf8'),
        featureRequest: await readFile(
            new URL('../../.github/ISSUE_TEMPLATE/feature_request.yaml', import.meta.url),
            'utf8',
        ),
    };
    const result = await runIssueFeedback(context, forms, createGitHubIssueRequest(process.env.GH_TOKEN));
    console.log(`Issue form validation: ${result.status}; feedback: ${result.feedback}.`);
    // Invalid contributor content fails the workflow only after feedback completes.
    if (result.status === 'invalid') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error: unknown) => {
        console.error(
            `Issue feedback automation failed: ${error instanceof IssueAutomationError ? error.message : 'Configuration or unexpected processing failure.'}`,
        );
        process.exitCode = 1;
    });
}
