import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAppOfficialRuntime } from '../../src/adapters/app-official-runtime.ts';
import { createMcpHttpServer } from '../../src/adapters/mcp-http-server.ts';
import { createPortReservations } from '../../src/adapters/port-reservation.ts';
import { createTargetHost } from '../../src/adapters/target-host.ts';
import { createGatewayCore } from '../../src/gateway/core.ts';
import { verifyOfficialPackageFiles } from '../../src/gateway/official/package-files.ts';
import { parseOfficialReleaseEvidence } from '../../src/gateway/official/release-evidence.ts';
import { guiAuthorization } from '../gui-authorization.ts';

declare const __DCT_FIXTURE_STAGE__: boolean;

const sealedStage = typeof __DCT_FIXTURE_STAGE__ !== 'undefined' && __DCT_FIXTURE_STAGE__;

// Explicit test composition for native regressions. This is never a Plugin/App entry or distribution file.
async function runtime() {
    if (sealedStage) {
        const stage = path.dirname(fileURLToPath(import.meta.url));
        const verified = await verifyAppOfficialRuntime({
            directory: path.join(stage, 'resources/app'),
            resources: path.join(stage, 'resources'),
            platform: process.platform,
            architecture: process.arch,
        });
        if (path.resolve(process.execPath) !== path.resolve(verified.nodeExecutable))
            throw new Error('Sealed fixture requires its original verified ordinary Node.');
        return verified;
    }
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const release = parseOfficialReleaseEvidence(
        JSON.parse(await readFile(path.join(root, 'tooling/official-server-release.json'), 'utf8')),
    );
    const official = await realpath(path.join(root, 'node_modules', release.name));
    await verifyOfficialPackageFiles(official, release, { pnpmInstalled: true });
    return { nodeExecutable: process.execPath, bin: path.join(official, release.bin) };
}
const authorization = guiAuthorization();
const windowsChromeAcceptance =
    !sealedStage &&
    process.platform === 'win32' &&
    authorization.allowed &&
    authorization.args.includes('--chrome-acceptance-readiness');
const portReservations = windowsChromeAcceptance ? createPortReservations() : undefined;
const core = await createGatewayCore({
    officialRuntime: await runtime(),
    ...(portReservations ? { createHost: () => createTargetHost({ portReservations, startupTimeoutMs: 40_000 }) } : {}),
});
const http = await createMcpHttpServer({
    port: 0,
    core: {
        ...core,
        control: (request, context) => {
            if ((request.action === 'start' || request.action === 'restart') && !guiAuthorization().allowed)
                throw new Error('Native fixture target creation requires explicit --allow-gui authorization.');
            return core.control(request, context);
        },
    },
});
process.stdout.write(`${JSON.stringify({ fixture: 'http-gateway', url: http.url })}\n`);
process.stdin.resume();
process.stdin.once('end', () => {
    void (async () => {
        await core.cleanup();
        await http.close();
    })().catch(() => {
        process.exitCode = 1;
    });
});
