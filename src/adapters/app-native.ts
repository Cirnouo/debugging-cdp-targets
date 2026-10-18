import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { type AppNativeEvidence, parseAppNativeEvidence } from '../domains/app-release.ts';
import { errorCode, isRecord } from '../shared/errors.ts';
import { verifyAppReleaseTree } from './app-delivery.ts';
import type { AdvisoryLock } from './app-singleton.ts';
import { readRegularFile } from './file-evidence.ts';

const require = createRequire(import.meta.url);

async function packageRoot(entry: string, name: string): Promise<string> {
    for (let directory = path.dirname(entry); ; directory = path.dirname(directory)) {
        try {
            const metadata: unknown = JSON.parse(
                (await readRegularFile(path.join(directory, 'package.json'))).toString('utf8'),
            );
            if (isRecord(metadata) && metadata.name === name) return realpath(directory);
        } catch (error) {
            if (errorCode(error) !== 'ENOENT') throw error;
        }
        if (path.dirname(directory) === directory) throw new Error('Native package root could not be verified.');
    }
}

export async function verifyAppNativeInputs(input: AppNativeEvidence) {
    const evidence = parseAppNativeEvidence(input);
    const expected = new Map(evidence.packages.map((entry) => [entry.package, entry]));
    const verified = new Map<string, { directory: string; files: Map<string, Buffer> }>();
    const pending: { name: string; resolver: NodeJS.Require }[] = [{ name: 'fs-native-extensions', resolver: require }];
    while (pending.length > 0) {
        const next = pending.pop();
        if (!next) break;
        const record = expected.get(next.name);
        if (!record) throw new Error('Native loader reached an unreviewed package.');
        const entry = next.resolver.resolve(next.name);
        const directory = await packageRoot(entry, next.name);
        const previous = verified.get(next.name);
        if (previous) {
            if (previous.directory !== directory) throw new Error('Native package resolution is ambiguous.');
            continue;
        }
        const files = await verifyAppReleaseTree(directory, record.files);
        const metadata: unknown = JSON.parse(files.get('package.json')?.toString('utf8') ?? 'null');
        if (
            !isRecord(metadata) ||
            metadata.name !== record.package ||
            metadata.version !== record.version ||
            (metadata.dependencies !== undefined && !isRecord(metadata.dependencies))
        )
            throw new Error('Native package metadata differs from reviewed evidence.');
        verified.set(next.name, { directory, files });
        const resolver = createRequire(path.join(directory, 'package.json'));
        for (const [name, range] of Object.entries(metadata.dependencies ?? {})) {
            if (typeof range !== 'string' || !expected.has(name))
                throw new Error('Native package has an unreviewed dependency.');
            pending.push({ name, resolver });
        }
    }
    if (verified.size !== expected.size) throw new Error('Native loading closure was not fully verified.');
    return verified;
}

export async function loadAppAdvisoryLock(evidence: AppNativeEvidence): Promise<AdvisoryLock> {
    await verifyAppNativeInputs(evidence);
    // Static original public package loading occurs only after every original source/prebuild/license verifies.
    const extension: unknown = require('fs-native-extensions');
    if (!isRecord(extension) || typeof extension.tryLock !== 'function')
        throw new Error('Invalid native advisory-lock interface.');
    const tryLock = extension.tryLock;
    return (descriptor, options) => {
        if (!Number.isSafeInteger(descriptor) || descriptor < 0) throw new Error('Invalid advisory-lock descriptor.');
        if (
            options !== undefined &&
            (!isRecord(options) ||
                Object.keys(options).length !== 1 ||
                !Object.hasOwn(options, 'shared') ||
                typeof options.shared !== 'boolean')
        )
            throw new Error('Invalid advisory-lock mode.');
        const result: unknown =
            options === undefined ? tryLock(descriptor) : tryLock(descriptor, { shared: options.shared });
        if (typeof result !== 'boolean') throw new Error('Invalid native advisory-lock result.');
        return result;
    };
}
