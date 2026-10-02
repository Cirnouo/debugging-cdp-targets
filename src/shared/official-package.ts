import { NPM_REGISTRY, PACKAGE_NAME, PACKAGE_VERSION } from './constants.ts';
import { isRecord } from './errors.ts';

export interface OfficialReleaseFile {
    path: string;
    sha256: string;
    bytes: number;
}
export interface OfficialReleaseEvidence {
    schemaVersion: 1;
    name: string;
    version: string;
    registry: string;
    tarball: string;
    integrity: string;
    bin: string;
    source: { repository: string; tag: string; commit: string };
    files: OfficialReleaseFile[];
}

function demand(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`Invalid official release: ${message}`);
}

function fields(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
    demand(isRecord(value) && Object.keys(value).sort().join() === [...names].sort().join(), 'evidence fields.');
}

export function isOfficialRelativePath(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value
            .split('/')
            .every(
                (part) =>
                    part.length > 0 &&
                    part !== '.' &&
                    part !== '..' &&
                    !/[\\:\x00-\x1f\x7f<>"|?*]/.test(part) &&
                    !/[. ]$/.test(part) &&
                    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
            )
    );
}

export function parseOfficialReleaseEvidence(input: unknown): OfficialReleaseEvidence {
    fields(input, ['schemaVersion', 'name', 'version', 'registry', 'tarball', 'integrity', 'bin', 'source', 'files']);
    demand(
        input.schemaVersion === 1 && input.name === PACKAGE_NAME && input.version === PACKAGE_VERSION,
        'package identity.',
    );
    demand(
        input.registry === NPM_REGISTRY &&
            input.tarball === `${NPM_REGISTRY}/${PACKAGE_NAME}/-/${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz`,
        'registry source.',
    );
    demand(
        typeof input.integrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(input.integrity),
        'SHA-512 integrity.',
    );
    demand(input.bin === 'build/src/bin/chrome-devtools-mcp.js', 'public Server bin.');
    fields(input.source, ['repository', 'tag', 'commit']);
    demand(
        input.source.repository === 'https://github.com/ChromeDevTools/chrome-devtools-mcp' &&
            input.source.tag === `chrome-devtools-mcp-v${PACKAGE_VERSION}` &&
            typeof input.source.commit === 'string' &&
            /^[a-f0-9]{40}$/.test(input.source.commit),
        'source provenance.',
    );
    demand(Array.isArray(input.files) && input.files.length > 0, 'file inventory.');
    const files: OfficialReleaseFile[] = [];
    const aliases = new Set<string>();
    let previous = '';
    for (const file of input.files) {
        fields(file, ['path', 'sha256', 'bytes']);
        demand(isOfficialRelativePath(file.path), 'unsafe relative path.');
        demand(file.path > previous && !aliases.has(file.path.toLowerCase()), 'duplicate, alias or unsorted path.');
        demand(typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256), 'SHA-256 digest.');
        demand(typeof file.bytes === 'number' && Number.isSafeInteger(file.bytes) && file.bytes >= 0, 'byte length.');
        previous = file.path;
        aliases.add(file.path.toLowerCase());
        files.push({ path: file.path, sha256: file.sha256, bytes: file.bytes });
    }
    for (const required of [
        'package.json',
        input.bin,
        'LICENSE',
        'build/src/third_party/THIRD_PARTY_NOTICES',
        'build/src/third_party/bundled-packages.json',
    ])
        demand(
            files.some((file) => file.path === required),
            `missing required file ${required}.`,
        );
    demand(
        files.some((file) => file.path.startsWith('skills/') && file.path.endsWith('/SKILL.md')),
        'missing published skills.',
    );
    return {
        schemaVersion: 1,
        name: input.name,
        version: input.version,
        registry: input.registry,
        tarball: input.tarball,
        integrity: input.integrity,
        bin: input.bin,
        source: { repository: input.source.repository, tag: input.source.tag, commit: input.source.commit },
        files,
    };
}

export function validateOfficialManifest(input: unknown, evidence: OfficialReleaseEvidence) {
    demand(
        isRecord(input) &&
            input.name === evidence.name &&
            input.version === evidence.version &&
            input.type === 'module',
        'installed package identity.',
    );
    demand(isRecord(input.bin) && input.bin[evidence.name] === `./${evidence.bin}`, 'installed public bin.');
    for (const group of ['dependencies', 'optionalDependencies'])
        demand(
            input[group] === undefined || (isRecord(input[group]) && Object.keys(input[group]).length === 0),
            'unbundled runtime dependencies.',
        );
    if (input.peerDependencies !== undefined) {
        demand(isRecord(input.peerDependencies) && isRecord(input.peerDependenciesMeta), 'optional peer metadata.');
        for (const peer of Object.keys(input.peerDependencies))
            demand(
                isRecord(input.peerDependenciesMeta[peer]) && input.peerDependenciesMeta[peer].optional === true,
                'required runtime peer.',
            );
    }
}
