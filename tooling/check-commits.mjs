import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { validateBranchName, validateCommitMessage } from './governance.mjs';

const zeroSha = /^0{40}$/;

export function buildCommitCheckRequest({ eventName, event, currentBranch }) {
    if (eventName === 'pull_request') {
        return {
            branches: [event.pull_request.head.ref],
            directMessages: [
                {
                    label: 'pull request title',
                    message: event.pull_request.title,
                },
            ],
            range: `${event.pull_request.base.sha}..${event.pull_request.head.sha}`,
            includeAncestors: false,
        };
    }
    if (eventName === 'push') {
        const branch = event.ref.startsWith('refs/heads/') ? event.ref.slice('refs/heads/'.length) : null;
        const isFirstPush = zeroSha.test(event.before);
        const isDeletion = zeroSha.test(event.after);
        return {
            branches: branch ? [branch] : [],
            directMessages: [],
            range: isDeletion ? null : isFirstPush ? event.after : `${event.before}..${event.after}`,
            includeAncestors: isFirstPush && !isDeletion,
        };
    }
    return {
        branches: [currentBranch],
        directMessages: [],
        range: 'HEAD',
        includeAncestors: true,
    };
}

export function validateCommitRecords(records) {
    const errors = [];
    for (const record of records) {
        const recordErrors = validateCommitMessage(record.message, {
            isMerge: record.parentCount > 1,
        });
        errors.push(...recordErrors.map((error) => `${record.sha}: ${error}`));
    }
    return errors;
}

export function resolveAuditBranch({ eventName, event, environment, localBranch }) {
    if (eventName === 'pull_request' || eventName === 'push') {
        return undefined;
    }
    if (eventName !== 'workflow_dispatch') {
        return localBranch;
    }
    const githubRef = environment.GITHUB_REF;
    if (githubRef?.startsWith('refs/heads/')) {
        return githubRef.slice('refs/heads/'.length);
    }
    if (environment.GITHUB_REF_TYPE === 'branch' && environment.GITHUB_REF_NAME) {
        return environment.GITHUB_REF_NAME;
    }
    const eventRef = event?.ref;
    if (typeof eventRef === 'string' && eventRef.length > 0 && !githubRef?.startsWith('refs/tags/')) {
        return eventRef.startsWith('refs/heads/') ? eventRef.slice('refs/heads/'.length) : eventRef;
    }
    return undefined;
}

function git(root, arguments_) {
    return execFileSync('git', arguments_, { cwd: root, encoding: 'utf8' }).trim();
}

function commitRecords(root, range) {
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
    let event;
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
    if (eventName === 'workflow_dispatch' && !currentBranch) {
        console.error(
            '- workflow_dispatch: an explicit branch ref is required; detached checkout state is not a branch identity.',
        );
        process.exitCode = 1;
        return;
    }
    const request = buildCommitCheckRequest({
        event,
        eventName,
        currentBranch,
    });
    const errors = [];
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
