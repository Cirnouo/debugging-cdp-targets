import { isRecord } from '../../src/shared/errors.ts';

type EventRequest = { eventName?: string | undefined; event?: unknown; currentBranch?: string | undefined };
const zeroSha = /^0{40}$/;

export function isZeroSha(value: string) {
    return zeroSha.test(value);
}

export function buildCommitCheckRequest({ eventName, event, currentBranch }: EventRequest) {
    if (eventName === 'pull_request') {
        if (
            !isRecord(event) ||
            !isRecord(event.pull_request) ||
            !isRecord(event.pull_request.head) ||
            !isRecord(event.pull_request.base)
        )
            throw new Error('Invalid pull request event.');
        const number = event.number;
        if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) {
            throw new Error('Invalid pull request number: expected a positive safe integer at the event root.');
        }
        const pr = event.pull_request;
        const head = event.pull_request.head;
        const base = event.pull_request.base;
        if (
            typeof head.ref !== 'string' ||
            typeof head.sha !== 'string' ||
            typeof base.sha !== 'string' ||
            typeof pr.title !== 'string' ||
            (typeof pr.body !== 'string' && pr.body !== null)
        )
            throw new Error('Invalid pull request identity.');
        if (pr.title.trimEnd().endsWith(`(#${number})`)) {
            throw new Error(
                `Remove (#${number}) from the pull request title; GitHub appends this number when squashing.`,
            );
        }
        const squashTitle = `${pr.title} (#${number})`;
        return {
            branches: [head.ref],
            directMessages: [
                {
                    label: 'pull request title',
                    message: pr.title,
                },
                {
                    label: 'pull request squash header',
                    message: squashTitle,
                },
            ],
            range: `${event.pull_request.base.sha}..${event.pull_request.head.sha}`,
            includeAncestors: false,
        };
    }
    if (eventName === 'push') {
        if (
            !isRecord(event) ||
            typeof event.ref !== 'string' ||
            typeof event.before !== 'string' ||
            typeof event.after !== 'string'
        )
            throw new Error('Invalid push event.');
        const branch = event.ref.startsWith('refs/heads/') ? event.ref.slice('refs/heads/'.length) : null;
        const isFirstPush = isZeroSha(event.before);
        const isDeletion = isZeroSha(event.after);
        return {
            branches: branch ? [branch] : [],
            directMessages: [],
            range: isDeletion ? null : isFirstPush ? event.after : `${event.before}..${event.after}`,
            includeAncestors: isFirstPush && !isDeletion,
        };
    }
    if (!currentBranch) throw new Error('A current branch identity is required.');
    return {
        branches: [currentBranch],
        directMessages: [],
        range: 'HEAD',
        includeAncestors: true,
    };
}

export function resolveAuditBranch({
    eventName,
    event,
    environment,
    localBranch,
}: {
    eventName?: string | undefined;
    event?: unknown;
    environment: NodeJS.ProcessEnv;
    localBranch?: string | undefined;
}) {
    if (eventName === 'pull_request' || eventName === 'push') {
        return undefined;
    }
    if (eventName !== 'workflow_dispatch' && eventName !== 'schedule') {
        return localBranch;
    }
    const refType = environment.GITHUB_REF_TYPE;
    if (refType !== undefined && refType !== 'branch') return undefined;
    const branches: string[] = [];
    let branchProof = refType === 'branch';
    const githubRef = environment.GITHUB_REF;
    if (githubRef !== undefined) {
        if (!githubRef.startsWith('refs/heads/')) return undefined;
        branches.push(githubRef.slice('refs/heads/'.length));
        branchProof = true;
    }
    if (environment.GITHUB_REF_NAME !== undefined) branches.push(environment.GITHUB_REF_NAME);
    const eventRef = isRecord(event) ? event.ref : undefined;
    if (eventRef !== undefined) {
        if (typeof eventRef !== 'string' || eventRef.length === 0) return undefined;
        if (eventRef.startsWith('refs/heads/')) {
            branches.push(eventRef.slice('refs/heads/'.length));
            branchProof = true;
        } else {
            if (eventRef.startsWith('refs/')) return undefined;
            branches.push(eventRef);
            if (eventName === 'workflow_dispatch') branchProof = true;
        }
    }
    return branchProof && branches.every((branch) => branch.length > 0) && new Set(branches).size === 1
        ? branches[0]
        : undefined;
}
