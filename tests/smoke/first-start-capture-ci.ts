import { execFileSync } from 'node:child_process';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'Cirnouo/debugging-cdp-targets';
const ref = 'refs/heads/fix/chrome-startup-stall';
const before = '1a598a7ca01c4e17535c5c9c98cd4564d6369e77';
const eventByteLimit = 262_144;
export type FirstStartCaptureAdmission = 'admitted' | 'ineligible' | 'unavailable';

function own(value: unknown, key: string): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
function sha(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) && value !== '0'.repeat(40);
}
function eligibleContext(context: unknown): boolean {
    return (
        own(context, 'eventName') === 'push' &&
        own(context, 'repository') === repository &&
        own(context, 'ref') === ref &&
        own(context, 'runAttempt') === '1' &&
        own(context, 'runnerOs') === 'Linux' &&
        sha(own(context, 'sha'))
    );
}

/** Runtime identity gate only; the one push and frozen head/tree still need separate human authorization. */
export function evaluateFirstStartCaptureAdmission(input: unknown): FirstStartCaptureAdmission {
    try {
        const context = own(input, 'context');
        const event = own(input, 'event');
        const checkout = own(input, 'checkout');
        if (!eligibleContext(context)) return 'ineligible';
        const after = own(context, 'sha');
        const tree = own(checkout, 'tree');
        return own(event, 'before') === before &&
            own(event, 'after') === after &&
            after !== before &&
            own(event, 'ref') === ref &&
            own(own(event, 'repository'), 'full_name') === repository &&
            own(event, 'created') === false &&
            own(event, 'deleted') === false &&
            own(event, 'forced') === false &&
            own(checkout, 'sha') === after &&
            sha(tree) &&
            tree === own(checkout, 'objectTree') &&
            own(checkout, 'clean') === true
            ? 'admitted'
            : 'ineligible';
    } catch {
        return 'ineligible';
    }
}

export function parseFirstStartCaptureEvent(input: unknown): unknown {
    try {
        if (!Buffer.isBuffer(input) || input.byteLength > eventByteLimit) return undefined;
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input));
    } catch {
        return undefined;
    }
}

function readEvent(file: string): Buffer {
    const handle = openSync(file, 'r');
    try {
        const metadata = fstatSync(handle);
        if (!metadata.isFile() || metadata.size > eventByteLimit) throw Error('Event unavailable.');
        const buffer = Buffer.alloc(eventByteLimit + 1);
        const count = readSync(handle, buffer, 0, buffer.length, 0);
        if (count !== metadata.size || count > eventByteLimit || readSync(handle, Buffer.alloc(1), 0, 1, count) !== 0)
            throw Error('Event unavailable.');
        return buffer.subarray(0, count);
    } finally {
        closeSync(handle);
    }
}
function git(args: string[]): string {
    return execFileSync('git', args, {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: 2_000,
        maxBuffer: 8_192,
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}
interface AdmissionIo {
    readEvent(file: string): unknown;
    checkout(expectedSha: string): unknown;
}
const nativeIo: AdmissionIo = {
    readEvent,
    checkout: (expectedSha) => ({
        sha: git(['rev-parse', '--verify', 'HEAD']),
        tree: git(['rev-parse', '--verify', 'HEAD^{tree}']),
        objectTree: git(['rev-parse', '--verify', `${expectedSha}^{tree}`]),
        clean: git(['status', '--porcelain', '--untracked-files=normal']) === '',
    }),
};

export function readFirstStartCaptureAdmission(
    environment: unknown = process.env,
    io: AdmissionIo = nativeIo,
): FirstStartCaptureAdmission {
    try {
        const context = {
            eventName: own(environment, 'GITHUB_EVENT_NAME'),
            repository: own(environment, 'GITHUB_REPOSITORY'),
            ref: own(environment, 'GITHUB_REF'),
            sha: own(environment, 'GITHUB_SHA'),
            runAttempt: own(environment, 'GITHUB_RUN_ATTEMPT'),
            runnerOs: own(environment, 'RUNNER_OS'),
        };
        if (!eligibleContext(context)) return 'ineligible';
        const eventPath = own(environment, 'GITHUB_EVENT_PATH');
        if (
            typeof eventPath !== 'string' ||
            !path.isAbsolute(eventPath) ||
            eventPath.length > 4_096 ||
            !sha(context.sha)
        )
            return 'unavailable';
        const event = parseFirstStartCaptureEvent(io.readEvent(eventPath));
        if (event === undefined) return 'unavailable';
        return evaluateFirstStartCaptureAdmission({ context, event, checkout: io.checkout(context.sha) });
    } catch {
        return 'unavailable';
    }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    process.stdout.write(`${readFirstStartCaptureAdmission()}\n`);
}
