import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseAppNativeEvidence } from '../../src/domains/app-release.ts';
import { type AdvisoryLock, verifyAppNativeInputs } from '../../src/platform/native/advisory-lock.ts';
import { isRecord } from '../../src/shared/errors.ts';

/** Actual-host vendor/kernel regression port. This grants no App or deployment admission. */
export async function deploymentAdvisoryLock(): Promise<AdvisoryLock> {
    const verified = await verifyAppNativeInputs(
        parseAppNativeEvidence(
            JSON.parse(await readFile(new URL('../../tooling/app-native-release.json', import.meta.url), 'utf8')),
        ),
    );
    const vendor = verified.get('fs-native-extensions');
    if (!vendor || verified.size !== 6) throw new Error('Incomplete original vendor verification.');
    // Use exactly the production verifier's resolution context, under the actual host identity.
    const require = createRequire(new URL('../../src/platform/native/advisory-lock.ts', import.meta.url));
    const entry = require.resolve('fs-native-extensions');
    const canonical = await realpath(entry);
    const relative = path.relative(vendor.directory, canonical).split(path.sep).join('/');
    if (canonical !== entry || !relative || !vendor.files.has(relative))
        throw new Error('Vendor public entry differs from the verified original package.');
    const extension: unknown = require('fs-native-extensions');
    if (!isRecord(extension) || typeof extension.tryLock !== 'function')
        throw new Error('Invalid original vendor lock interface.');
    const tryLock = extension.tryLock;
    return (descriptor, options) => {
        const result: unknown =
            options === undefined ? tryLock(descriptor) : tryLock(descriptor, { shared: options.shared });
        if (typeof result !== 'boolean') throw new Error('Invalid original vendor lock result.');
        return result;
    };
}
