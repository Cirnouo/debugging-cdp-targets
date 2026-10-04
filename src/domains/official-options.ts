// Explicitly reviewed options from the delivered official 1.10.1 public server.
// Browser creation/attachment, config files and CLI mode remain gateway-owned.
export const CATALOG_FLAGS = [
    'categoryInput',
    'categoryNavigation',
    'categoryEmulation',
    'categoryPerformance',
    'categoryNetwork',
    'categoryDebugging',
    'categoryExtensions',
    'categoryExperimentalThirdParty',
    'categoryMemory',
    'categoryExperimentalWebmcp',
    'categoryPwa',
    'experimentalVision',
    'memoryDebugging',
    'devtoolsComments',
    'experimentalInteropTools',
    'experimentalScreencast',
    'javascriptEvaluation',
] as const;
const booleans = [
    ...CATALOG_FLAGS,
    'pageIdRouting',
    'acceptInsecureCerts',
    'experimentalDevtools',
    'experimentalStructuredContent',
    'experimentalToonFormat',
    'experimentalIncludeAllPages',
    'performanceCrux',
    'usageStatistics',
    'sourceMaps',
    'slim',
    'redactNetworkHeaders',
    'allowUnrestrictedPaths',
];
const scalars = [
    'logFile',
    'viewport',
    'experimentalDataFormat',
    'experimentalFfmpegPath',
    'experimentalScreencastFps',
    'screenshotFormat',
    'screenshotQuality',
    'screenshotMaxWidth',
    'screenshotMaxHeight',
];
const arrays = ['filesystemRoot', 'blockedUrlPattern', 'allowedUrlPattern'];
const normalize = (name: string) => name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
const alias = (name: string) =>
    name === 'workspace' ? 'filesystemRoot' : name === 'experimentalMemory' ? 'memoryDebugging' : name;
export type McpOption = { values: (string | boolean)[]; args: string[] };
export function parseMcpArgs(args: readonly string[]) {
    const options = new Map<string, McpOption>();
    for (let index = 0; index < args.length; index++) {
        const raw = args[index];
        if (typeof raw !== 'string' || raw.includes('\0')) throw new Error('Invalid official Server argument.');
        const match = /^--(no-)?([A-Za-z][A-Za-z-]*)(?:=(.*))?$/.exec(raw);
        if (!match?.[2])
            throw new Error('Use supported explicit long official Server options; positional commands are prohibited.');
        const key = alias(normalize(match[2]));
        const boolean = booleans.some((option) => option === key);
        const array = arrays.includes(key);
        if (!boolean && !array && !scalars.includes(key))
            throw new Error(`Unsupported or gateway-owned official Server option: ${key}.`);
        const previous = options.get(key);
        if (previous && !array) throw new Error(`Duplicate official Server option: ${key}.`);
        const tokens = [raw];
        let value: string | boolean;
        if (boolean) {
            if (match[1] && match[3] !== undefined)
                throw new Error('Negated boolean options cannot also supply a value.');
            let provided = match[3];
            if (provided === undefined && (args[index + 1] === 'true' || args[index + 1] === 'false')) {
                provided = args[++index];
                if (provided) tokens.push(provided);
            }
            if (provided !== undefined && provided !== 'true' && provided !== 'false')
                throw new Error(`Expected a boolean for ${key}.`);
            value = match[1] ? false : provided !== 'false';
        } else {
            if (match[1]) throw new Error('Only boolean official options can be negated.');
            const provided = match[3] ?? args[++index];
            if (typeof provided !== 'string' || !provided || provided.startsWith('-') || provided.includes('\0'))
                throw new Error(`A literal value is required for ${key}.`);
            if (match[3] === undefined) tokens.push(provided);
            value = provided;
        }
        options.set(key, {
            values: [...(previous?.values ?? []), value],
            args: [...(previous?.args ?? []), ...tokens],
        });
    }
    return options;
}
export function suggestMcpArgs(args: readonly string[], required: Record<string, boolean>) {
    const options = parseMcpArgs(args);
    for (const [key, value] of Object.entries(required))
        options.set(key, { values: [value], args: [`--${key}=${value}`] });
    return [...options.values()].flatMap((option) => option.args);
}
