import { createHash } from 'node:crypto';
import { MINIMUM_EXTENSION_CHROME_MAJOR, MINIMUM_EXTENSION_MCP_VERSION } from '../../shared/constants.mjs';
import { fail } from '../../shared/errors.mjs';
import { parseSemver, semverAtLeast } from '../../shared/semver.mjs';
import { isIntegerInRange, normalizePath } from '../../shared/values.mjs';
import { createSessionRecord } from '../managed-session/record.mjs';

export function getDaemonSessionId(state) {
    const rootProcessId = Number(state?.rootProcessId);
    const port = Number(state?.port);
    const startedAtUtc = String(state?.startedAtUtc || '');
    if (
        !Number.isInteger(rootProcessId) ||
        rootProcessId <= 0 ||
        !isIntegerInRange(port, 1, 65535) ||
        !Number.isFinite(Date.parse(startedAtUtc))
    ) {
        fail('DAEMON_SESSION_ID_INVALID', 'A verified target identity is required to derive the daemon session ID.');
    }
    return createHash('sha256').update(`${rootProcessId}\0${port}\0${startedAtUtc}`).digest('hex').slice(0, 32);
}

export function buildScopedCliArguments({ resolvedPackageVersion, state, commandArguments }) {
    parseSemver(resolvedPackageVersion);
    if (!Array.isArray(commandArguments) || commandArguments.length === 0) {
        fail('CLI_ARGUMENTS_INVALID', 'At least one scoped chrome-devtools CLI command is required.');
    }
    return [`--sessionId=${getDaemonSessionId(state)}`, ...commandArguments];
}

export function resolveExtensionMode({
    requested,
    targetAdapter,
    browserProduct,
    browserMajorVersion,
    resolvedPackageVersion,
    startHelp,
    startHelpExitCode,
    extensionCommandsAvailable,
}) {
    if (!requested) return { enabled: false, reason: 'not-requested' };
    const supported =
        targetAdapter === 'chrome' &&
        /^Chrome\/\d+/i.test(String(browserProduct)) &&
        Number.isInteger(browserMajorVersion) &&
        browserMajorVersion >= MINIMUM_EXTENSION_CHROME_MAJOR &&
        typeof resolvedPackageVersion === 'string' &&
        semverAtLeast(resolvedPackageVersion, MINIMUM_EXTENSION_MCP_VERSION) &&
        startHelpExitCode === 0 &&
        /(?:^|\s)--categoryExtensions(?:[=\s]|$)/m.test(String(startHelp)) &&
        extensionCommandsAvailable === true;
    if (!supported) {
        fail(
            'EXTENSIONS_UNSUPPORTED',
            'Extension tools require Google Chrome 149 or newer and a compatible chrome-devtools-mcp CLI with extension commands.',
        );
    }
    return { enabled: true, reason: 'supported' };
}

export function buildDaemonRuntimeOptions({ port, workspaces, extensionsEnabled }) {
    const options = [
        `--browserUrl=http://127.0.0.1:${port}`,
        '--no-usage-statistics',
        '--no-performance-crux',
        `--categoryExtensions=${extensionsEnabled ? 'true' : 'false'}`,
    ];
    for (const workspace of workspaces) options.push(`--workspace=${workspace}`);
    return options;
}

export function buildDaemonArguments({
    resolvedPackageVersion,
    port,
    workspaces,
    extensionsEnabled,
    ...stateIdentity
}) {
    parseSemver(resolvedPackageVersion);
    if (!isIntegerInRange(port, 1, 65535)) fail('PORT_INVALID', 'The daemon browser port is invalid.');
    const packageSpec = `chrome-devtools-mcp@${resolvedPackageVersion}`;
    const arguments_ = buildScopedCliArguments({
        resolvedPackageVersion,
        state: { ...stateIdentity, port },
        commandArguments: ['start', ...buildDaemonRuntimeOptions({ port, workspaces, extensionsEnabled })],
    });
    return { packageSpec, arguments: arguments_ };
}

export function buildToolCliArguments({ state, toolArguments }) {
    return buildScopedCliArguments({
        resolvedPackageVersion: state.resolvedPackageVersion,
        state,
        commandArguments: toolArguments,
    });
}

export function coerceToolValue(name, definition, value) {
    const type = definition.type || 'string';
    if (type === 'boolean') {
        if (value === true || value === false) return value;
        if (String(value).toLowerCase() === 'true') return true;
        if (String(value).toLowerCase() === 'false') return false;
        fail('TOOL_ARGUMENT_INVALID', `${name} must be true or false.`);
    }
    if (type === 'number' || type === 'integer') {
        const number = Number(value);
        if (!Number.isFinite(number) || (type === 'integer' && !Number.isInteger(number))) {
            fail('TOOL_ARGUMENT_INVALID', `${name} must be a finite ${type}.`);
        }
        return number;
    }
    if (type === 'array') {
        if (Array.isArray(value)) return value.map(String);
        const stringValue = String(value);
        if (stringValue.startsWith('[')) {
            try {
                const parsed = JSON.parse(stringValue);
                if (Array.isArray(parsed)) return parsed;
            } catch {
                /* Report the stable validation error below. */
            }
            fail('TOOL_ARGUMENT_INVALID', `${name} must be an array or a repeated option.`);
        }
        return [stringValue];
    }
    const stringValue = String(value);
    if (Array.isArray(definition.enum) && !definition.enum.includes(stringValue)) {
        fail('TOOL_ARGUMENT_INVALID', `${name} must be one of: ${definition.enum.join(', ')}.`);
    }
    return stringValue;
}

export function parseToolInvocation({ commands, toolArguments }) {
    if (!commands || typeof commands !== 'object' || !Array.isArray(toolArguments) || toolArguments.length === 0) {
        fail('TOOL_ARGUMENT_INVALID', 'A pinned command schema and tool arguments are required.');
    }
    const [tool, ...tokens] = toolArguments;
    const command = commands[tool];
    if (!command || typeof command !== 'object')
        fail('TOOL_COMMAND_INVALID', `Unknown official DevTools tool '${tool}'.`);
    const definitions = Object.entries(command.args || {});
    const required = definitions.filter(([, definition]) => definition.required === true);
    const args = {};
    let tokenIndex = 0;
    for (const [name, definition] of required) {
        const value = tokens[tokenIndex];
        if (value === undefined || String(value).startsWith('--'))
            fail('TOOL_ARGUMENT_REQUIRED', `Tool ${tool} requires positional argument ${name}.`);
        args[name] = coerceToolValue(name, definition, value);
        tokenIndex += 1;
    }
    for (const [name, definition] of definitions) {
        if (definition.required !== true && definition.default !== undefined) args[name] = definition.default;
    }

    let outputFormat = 'md';
    const optionalByNormalizedName = new Map(
        definitions
            .filter(([, definition]) => definition.required !== true)
            .map(([name, definition]) => [name.replaceAll('-', '').toLowerCase(), { name, definition }]),
    );
    while (tokenIndex < tokens.length) {
        const token = String(tokens[tokenIndex]);
        if (!token.startsWith('--'))
            fail('TOOL_ARGUMENT_INVALID', `Unexpected positional argument '${token}' for tool ${tool}.`);
        const separator = token.indexOf('=');
        const rawName = token.slice(2, separator >= 0 ? separator : undefined);
        let rawValue = separator >= 0 ? token.slice(separator + 1) : undefined;
        const normalizedName = rawName.replaceAll('-', '').toLowerCase();
        if (normalizedName === 'outputformat') {
            if (rawValue === undefined) {
                tokenIndex += 1;
                rawValue = tokens[tokenIndex];
            }
            if (!['md', 'json'].includes(rawValue)) fail('TOOL_ARGUMENT_INVALID', 'output-format must be md or json.');
            outputFormat = rawValue;
            tokenIndex += 1;
            continue;
        }
        const option = optionalByNormalizedName.get(normalizedName);
        if (!option) fail('TOOL_ARGUMENT_INVALID', `Unknown option --${rawName} for tool ${tool}.`);
        if (rawValue === undefined) {
            const next = tokens[tokenIndex + 1];
            if (option.definition.type === 'boolean' && (next === undefined || String(next).startsWith('--'))) {
                rawValue = true;
            } else {
                tokenIndex += 1;
                rawValue = tokens[tokenIndex];
                if (rawValue === undefined) fail('TOOL_ARGUMENT_REQUIRED', `Option --${rawName} requires a value.`);
            }
        }
        const parsedValue = coerceToolValue(option.name, option.definition, rawValue);
        if (option.definition.type === 'array' && Array.isArray(args[option.name]))
            args[option.name].push(...parsedValue);
        else args[option.name] = parsedValue;
        tokenIndex += 1;
    }
    return { tool, args, outputFormat };
}

export function parseDaemonStatus(result) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (/^chrome-devtools-mcp daemon is not running\.$/im.test(output)) {
        return { running: false, processId: 0, version: '', arguments: [] };
    }
    const detailMatch =
        output.match(/pid=(\d+).*?\bversion=([^\s]+)/i) || output.match(/PID\s*:\s*(\d+).*?Version\s*:\s*([^\s]+)/is);
    const argsMatch = output.match(/^args=(\[[^\r\n]*\])$/im);
    if (!detailMatch || !argsMatch) {
        fail('DAEMON_STATUS_INVALID', 'The official CLI returned an unrecognized daemon status.', {
            exitCode: result.exitCode,
            stderr: String(result.stderr || '').trim(),
        });
    }
    let arguments_;
    try {
        arguments_ = JSON.parse(argsMatch[1]);
    } catch (error) {
        fail('DAEMON_STATUS_INVALID', 'The daemon argument list was not valid JSON.', { cause: error.message });
    }
    if (!Array.isArray(arguments_) || !arguments_.every((item) => typeof item === 'string')) {
        fail('DAEMON_STATUS_INVALID', 'The daemon argument list had an invalid shape.');
    }
    return {
        running: true,
        processId: Number(detailMatch[1]),
        version: detailMatch[2],
        arguments: arguments_,
    };
}

export function daemonArgumentValue(arguments_, names) {
    for (let index = 0; index < arguments_.length; index += 1) {
        for (const name of names) {
            if (arguments_[index] === name && index + 1 < arguments_.length) return arguments_[index + 1];
            if (arguments_[index].startsWith(`${name}=`)) return arguments_[index].slice(name.length + 1);
        }
    }
    return undefined;
}

export function daemonExtensionMode(arguments_) {
    if (
        arguments_.some(
            (argument) =>
                argument === '--no-category-extensions' ||
                argument === '--category-extensions=false' ||
                argument === '--categoryExtensions=false',
        )
    )
        return false;
    if (
        arguments_.some(
            (argument) =>
                argument === '--category-extensions' ||
                argument === '--category-extensions=true' ||
                argument === '--categoryExtensions=true',
        )
    )
        return true;
    return undefined;
}

export function daemonWorkspaces(arguments_) {
    const values = [];
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        for (const name of ['--filesystem-root', '--workspace']) {
            if (argument === name && index + 1 < arguments_.length) values.push(arguments_[index + 1]);
            else if (argument.startsWith(`${name}=`)) values.push(argument.slice(name.length + 1));
        }
    }
    return values;
}

export function validateDaemonStatus({ state, status, processExists: processIsPresent = true }) {
    if (!status?.running) return { valid: false, reason: 'not-running' };
    if (status.processId !== state.daemonProcessId) return { valid: false, reason: 'pid-mismatch' };
    const exists = typeof processIsPresent === 'function' ? processIsPresent(status.processId) : processIsPresent;
    if (!exists) return { valid: false, reason: 'process-missing' };
    if (status.version !== state.resolvedPackageVersion) return { valid: false, reason: 'version-mismatch' };
    const browserUrl = daemonArgumentValue(status.arguments, ['--browser-url', '--browserUrl']);
    if (browserUrl !== `http://127.0.0.1:${state.port}`) return { valid: false, reason: 'browser-url-mismatch' };
    if (daemonExtensionMode(status.arguments) !== state.extensionsEnabled)
        return { valid: false, reason: 'extension-mode-mismatch' };
    if (!status.arguments.includes('--no-usage-statistics'))
        return { valid: false, reason: 'usage-statistics-enabled' };
    if (!status.arguments.includes('--no-performance-crux'))
        return { valid: false, reason: 'performance-crux-enabled' };
    if (status.arguments.some((argument) => /^--(?:category-?pwa|no-category-?pwa)(?:=|$)/i.test(argument)))
        return { valid: false, reason: 'pwa-category-present' };
    const expectedWorkspaces = [...state.workspaces].map(normalizePath).sort();
    const actualWorkspaces = daemonWorkspaces(status.arguments).map(normalizePath).sort();
    if (JSON.stringify(actualWorkspaces) !== JSON.stringify(expectedWorkspaces))
        return { valid: false, reason: 'workspace-mismatch' };
    return { valid: true, reason: 'valid' };
}

export function resolveStopDaemonAction({ state, status, processExists: processIsPresent = true }) {
    if (!status?.running) return { action: 'none', reason: 'not-running' };
    const recoveredFromDetached = state.status === 'detached';
    const candidate = recoveredFromDetached
        ? createSessionRecord({ ...state, status: 'active', daemonProcessId: Number(status.processId) })
        : state;
    const identity = validateDaemonStatus({ state: candidate, status, processExists: processIsPresent });
    if (!identity.valid) return { action: 'reject', reason: identity.reason };
    return { action: 'stop', state: candidate, recoveredFromDetached };
}
