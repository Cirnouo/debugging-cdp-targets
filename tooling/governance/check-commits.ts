import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../../src/shared/errors.ts';
import { validatePullRequestBody } from '../submissions/pull-requests.ts';
import { buildCommitCheckRequest, isZeroSha, resolveAuditBranch } from './commit-events.ts';
import { validateBranchName } from './commit-grammar.ts';
import { validateCommitMessage } from './commit-validation.ts';

interface CommitRecord {
    sha: string;
    message: string;
    parentCount: number;
}

export function validateCommitRecords(records: CommitRecord[]) {
    const errors = [];
    for (const record of records) {
        const recordErrors = validateCommitMessage(record.message, {
            isMerge: record.parentCount > 1,
        });
        errors.push(...recordErrors.map((error) => `${record.sha}: ${error}`));
    }
    return errors;
}

function git(root: string, arguments_: string[]) {
    return execFileSync('git', arguments_, { cwd: root, encoding: 'utf8' }).trim();
}

function commitRecords(root: string, range: string | null): CommitRecord[] {
    if (!range) {
        return [];
    }
    const output = execFileSync('git', ['log', '--format=%H%x00%P%x00%B%x00%x1e', range], {
        cwd: root,
        encoding: 'utf8',
    });
    return output
        .split('\x1e')
        .map((record) => record.replace(/^\r?\n/, ''))
        .filter(Boolean)
        .map((record) => {
            const framedRecord = record.endsWith('\0') ? record.slice(0, -1) : record;
            const firstSeparator = framedRecord.indexOf('\0');
            const secondSeparator = framedRecord.indexOf('\0', firstSeparator + 1);
            if (firstSeparator < 0 || secondSeparator < 0) {
                throw new Error('Git returned a malformed commit record.');
            }
            const sha = framedRecord.slice(0, firstSeparator);
            const parents = framedRecord.slice(firstSeparator + 1, secondSeparator);
            const message = framedRecord.slice(secondSeparator + 1);
            return {
                sha,
                message,
                parentCount: parents ? parents.split(' ').filter(Boolean).length : 0,
            };
        });
}

function run() {
    const root = process.cwd();
    const eventName = process.env.GITHUB_EVENT_NAME;
    let event: unknown;
    if (process.env.GITHUB_EVENT_PATH) {
        event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    }
    const localBranch = eventName ? undefined : git(root, ['branch', '--show-current']);
    const currentBranch = resolveAuditBranch({
        environment: process.env,
        event,
        eventName,
        localBranch,
    });
    if ((eventName === 'workflow_dispatch' || eventName === 'schedule') && !currentBranch) {
        console.error(
            `- ${eventName}: an explicit branch ref is required; detached checkout state is not a branch identity.`,
        );
        process.exitCode = 1;
        return;
    }
    const request = buildCommitCheckRequest({
        event,
        eventName,
        currentBranch,
    });
    if (
        eventName === 'push' &&
        isRecord(event) &&
        event.forced === true &&
        typeof event.before === 'string' &&
        !isZeroSha(event.before) &&
        typeof event.after === 'string' &&
        !isZeroSha(event.after)
    ) {
        const base = spawnSync('git', ['cat-file', '-e', `${event.before}^{commit}`], {
            cwd: root,
            encoding: 'utf8',
            windowsHide: true,
        });
        if (base.error) throw base.error;
        if (base.status !== 0) {
            // A fresh checkout cannot fetch an unreachable, replaced commit. Audit
            // every current ancestor instead of skipping messages or changing history.
            if (git(root, ['rev-parse', '--is-shallow-repository']) !== 'false')
                throw new Error('Complete history is required to audit a forced push with a missing base.');
            request.range = event.after;
            request.includeAncestors = true;
        }
    }
    if (request.includeAncestors && git(root, ['rev-parse', '--is-shallow-repository']) !== 'false') {
        throw new Error('Complete history is required to audit all commit ancestors.');
    }
    const errors = [];
    if (eventName === 'pull_request' && isRecord(event) && isRecord(event.pull_request)) {
        // The request builder has checked event identity. Validate the original
        // review description against the current template independently of headers.
        const body = event.pull_request.body;
        if (typeof body !== 'string' && body !== null) throw new Error('Invalid pull request body.');
        const template = readFileSync(new URL('../../.github/PULL_REQUEST_TEMPLATE.md', import.meta.url), 'utf8');
        errors.push(...validatePullRequestBody(body, template));
    }
    for (const branch of request.branches) {
        errors.push(...validateBranchName(branch).map((error) => `${branch}: ${error}`));
    }
    for (const direct of request.directMessages) {
        errors.push(...validateCommitMessage(direct.message).map((error) => `${direct.label}: ${error}`));
    }
    errors.push(...validateCommitRecords(commitRecords(root, request.range)));
    if (errors.length > 0) {
        console.error(errors.map((error) => `- ${error}`).join('\n'));
        process.exitCode = 1;
        return;
    }
    console.log('Commit and branch audit passed.');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (fileURLToPath(import.meta.url) === invokedPath) {
    run();
}
