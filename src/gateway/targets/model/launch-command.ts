import { findEnvironmentKey } from '../../../shared/environment-key.ts';
import { isRecord } from '../../../shared/errors.ts';

export interface ApplicationLaunch {
    executable: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
}

export interface LaunchDefinition {
    executablePath: string;
    arguments: string[];
    cwd?: string;
    env?: Record<string, string>;
}

export interface PreparedLaunchDefinition {
    readonly executablePath: string;
    readonly arguments: readonly string[];
    readonly cwd?: string;
    readonly overrides: Readonly<Record<string, string>>;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly windowsEnvironment: boolean;
    readonly portPolicy: Readonly<{ kind: 'fixed'; port: number } | { kind: 'automatic'; basePort: number }>;
}

export function mergeLaunchEnvironment(
    environment: Readonly<Record<string, string | undefined>>,
    overrides: Readonly<Record<string, string | undefined>>,
    windows = false,
): Record<string, string | undefined> {
    const values = new Map<string, [string, string | undefined]>();
    for (const [name, value] of [...Object.entries(environment), ...Object.entries(overrides)])
        values.set(windows ? name.toLowerCase() : name, [name, value]);
    return Object.fromEntries(values.values());
}

/** Expand ordinary variables once; data-directory bytes are inserted only at final binding. */
export function prepareLaunchDefinition(
    value: unknown,
    basePort: number,
    environment: Record<string, string | undefined>,
    windowsEnvironment = false,
): PreparedLaunchDefinition {
    const launch = parseApplicationLaunch(value);
    const args = (launch.args ?? []).map((argument) => expandEnvironment(argument, environment, windowsEnvironment));
    const overrides = Object.fromEntries(
        Object.entries(launch.env ?? {}).map(([name, setting]) => [
            name,
            expandEnvironment(setting, environment, windowsEnvironment),
        ]),
    );
    const argumentPort = explicitDebuggingPort(args);
    const environmentPorts = Object.values(overrides).flatMap((setting) =>
        [...setting.matchAll(/(?:^|\s)--remote-debugging-port(?:[=:]|\s+|$)([^\s]*)/gi)].map((match) => match[1] ?? ''),
    );
    const sources = [...(argumentPort === null ? [] : [argumentPort]), ...environmentPorts];
    if (sources.length > 1) throw new Error('Duplicate remote debugging port sources conflict.');
    const fixed = sources[0];
    const portPolicy =
        fixed !== undefined && !fixed.includes(PORT_PLACEHOLDER)
            ? { kind: 'fixed' as const, port: Number(fixed) }
            : { kind: 'automatic' as const, basePort };
    const validationPort = portPolicy.kind === 'fixed' ? portPolicy.port : basePort;
    const validated = resolveLaunchDefinition(
        value,
        validationPort,
        environment,
        '/dct-prepared-data',
        windowsEnvironment,
    );
    if (
        !sources.length &&
        ![...args, ...Object.values(overrides)].some((argument) => argument.includes(PORT_PLACEHOLDER))
    )
        args.push(`${DEFAULT_DEBUGGING_SWITCH}=${PORT_PLACEHOLDER}`);
    return Object.freeze({
        executablePath: validated.executablePath,
        arguments: Object.freeze(args),
        ...(validated.cwd === undefined ? {} : { cwd: validated.cwd }),
        overrides: Object.freeze(overrides),
        environment: Object.freeze({ ...environment }),
        windowsEnvironment,
        portPolicy: Object.freeze(portPolicy),
    });
}

export function bindPreparedLaunch(
    prepared: PreparedLaunchDefinition,
    port: number,
    dataDirectory?: string,
): LaunchDefinition {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The CDP port is invalid.');
    if (prepared.portPolicy.kind === 'fixed' && prepared.portPolicy.port !== port)
        throw new Error('The fixed CDP port cannot change.');
    const bind = (value: string) =>
        value.replace(/\{port\}|\{dataDir\}/g, (token) => {
            if (token === PORT_PLACEHOLDER) return String(port);
            if (dataDirectory === undefined) throw new Error('The launch command requires a data directory binding.');
            return dataDirectory;
        });
    const environment = mergeLaunchEnvironment(
        prepared.environment,
        Object.fromEntries(Object.entries(prepared.overrides).map(([name, value]) => [name, bind(value)])),
        prepared.windowsEnvironment,
    );
    return {
        executablePath: prepared.executablePath,
        arguments: prepared.arguments.map(bind),
        ...(prepared.cwd === undefined ? {} : { cwd: prepared.cwd }),
        env: Object.fromEntries(
            Object.entries(environment).filter((pair): pair is [string, string] => pair[1] !== undefined),
        ),
    };
}

const PORT_PLACEHOLDER = '{port}';
const DATA_DIRECTORY_PLACEHOLDER = '{dataDir}';
const DEFAULT_DEBUGGING_SWITCH = '--remote-debugging-port';

function expandEnvironment(
    argument: string,
    environment: Record<string, string | undefined>,
    windowsEnvironment = false,
) {
    function value(name: string) {
        const key = findEnvironmentKey(environment, name, windowsEnvironment);
        if (key === undefined) throw new Error(`Environment variable ${name} is undefined.`);
        return String(environment[key]);
    }
    const expanded = argument
        .replace(/%([A-Za-z_][A-Za-z\d_]*)%/g, (_match: string, name: string) => value(name))
        .replace(/\$\{([A-Za-z_][A-Za-z\d_]*)\}/g, (_match: string, name: string) => value(name));
    if (/%[A-Za-z_][A-Za-z\d_]*%|\$\{[A-Za-z_][A-Za-z\d_]*\}/.test(expanded)) {
        throw new Error('The launch command contains an unresolved environment variable.');
    }
    return expanded;
}

function explicitDebuggingPort(arguments_: string[]) {
    const ports: (string | undefined)[] = [];
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === undefined) throw new Error('Missing launch argument.');
        const match = argument.match(/^--remote-debugging-port(?:=|:)(.*)$/i);
        if (match) ports.push(match[1]);
        if (/^--remote-debugging-port$/i.test(argument)) ports.push(arguments_[index + 1]);
        if (/^--remote-debugging-pipe(?:=|$)/i.test(argument))
            throw new Error('Debugging pipe conflicts with a CDP port.');
    }
    if (ports.length > 1) throw new Error('Duplicate remote debugging port sources conflict.');
    return ports.length === 0 ? null : ports[0];
}

function stringValue(value: unknown, label: string, empty = false): asserts value is string {
    if (typeof value !== 'string' || value.includes('\0') || (!empty && !value.trim()))
        throw new Error(`Invalid ${label}.`);
}

export function parseApplicationLaunch(value: unknown): ApplicationLaunch {
    if (!isRecord(value) || Object.keys(value).some((key) => !['executable', 'args', 'cwd', 'env'].includes(key)))
        throw new Error('A structured application launch is required.');
    stringValue(value.executable, 'executable');
    if (value.executable.includes(PORT_PLACEHOLDER) || value.executable.includes(DATA_DIRECTORY_PLACEHOLDER))
        throw new Error('The executable cannot contain launch placeholders.');
    if (value.args !== undefined && !Array.isArray(value.args)) throw new Error('Arguments must be an array.');
    const args: string[] | undefined = value.args?.map((argument: unknown) => {
        stringValue(argument, 'argument', true);
        return argument;
    });
    if (value.cwd !== undefined) {
        stringValue(value.cwd, 'working directory');
        if (value.cwd.includes(PORT_PLACEHOLDER) || value.cwd.includes(DATA_DIRECTORY_PLACEHOLDER))
            throw new Error('The working directory cannot contain launch placeholders.');
    }
    let env: Record<string, string> | undefined;
    if (value.env !== undefined) {
        if (!isRecord(value.env)) throw new Error('Environment must be an object.');
        env = Object.fromEntries(
            Object.entries(value.env).map(([name, setting]) => {
                if (!name || /[=\0]/.test(name)) throw new Error('Invalid environment variable name.');
                if (name.includes(DATA_DIRECTORY_PLACEHOLDER))
                    throw new Error('Environment variable names cannot contain {dataDir}.');
                stringValue(setting, 'environment variable value', true);
                return [name, setting];
            }),
        );
    }
    return {
        executable: value.executable,
        ...(args === undefined ? {} : { args }),
        ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
        ...(env === undefined ? {} : { env }),
    };
}

export function validateDataIsolationBinding(
    value: unknown,
    mode: 'none' | 'data-dir',
    environment: Record<string, string | undefined>,
    windowsEnvironment = false,
): void {
    const launch = parseApplicationLaunch(value);
    const references = [...(launch.args ?? []), ...Object.values(launch.env ?? {})].some((argument) =>
        expandEnvironment(argument, environment, windowsEnvironment).includes(DATA_DIRECTORY_PLACEHOLDER),
    );
    if (mode === 'data-dir' && !references)
        throw new Error('Data directory isolation requires an explicit {dataDir} binding.');
    if (mode === 'none' && references) throw new Error('No isolation forbids {dataDir} binding.');
}

export function resolveLaunchDefinition(
    value: unknown,
    port: number,
    environment: Record<string, string | undefined>,
    dataDir?: string,
    windowsEnvironment = false,
): LaunchDefinition {
    const launch = parseApplicationLaunch(value);
    const expand = (argument: string) => expandEnvironment(argument, environment, windowsEnvironment);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The CDP port is invalid.');
    if (dataDir !== undefined) stringValue(dataDir, 'data directory binding');
    const substitutePort = (argument: string) => argument.replaceAll(PORT_PLACEHOLDER, String(port));
    const substitute = (argument: string) =>
        expand(argument).replace(/\{port\}|\{dataDir\}/g, (placeholder) => {
            if (placeholder === PORT_PLACEHOLDER) return String(port);
            if (dataDir === undefined) throw new Error('The launch command requires a data directory binding.');
            return dataDir;
        });
    const raw = [...(launch.args ?? []), ...Object.values(launch.env ?? {})].map((argument) => expand(argument));
    const hasPlaceholder = raw.some((argument) => argument.includes(PORT_PLACEHOLDER));
    const args = (launch.args ?? []).map(substitute);
    const env =
        launch.env === undefined
            ? undefined
            : Object.fromEntries(Object.entries(launch.env).map(([key, setting]) => [key, substitute(setting)]));
    const argumentPort = explicitDebuggingPort((launch.args ?? []).map((argument) => substitutePort(expand(argument))));
    const environmentPorts: string[] = [];
    for (const template of Object.values(launch.env ?? {})) {
        const setting = substitutePort(expand(template));
        if (/(?:^|\s)--remote-debugging-pipe(?:=|\s|$)/i.test(setting))
            throw new Error('Debugging pipe conflicts with a CDP port.');
        for (const match of setting.matchAll(/(?:^|\s)--remote-debugging-port(?:[=:]|\s+|$)([^\s]*)/gi)) {
            environmentPorts.push(match[1] ?? '');
        }
    }
    const ports = [...(argumentPort === null ? [] : [argumentPort]), ...environmentPorts];
    if (ports.length > 1) throw new Error('Duplicate remote debugging port sources conflict.');
    if (ports.some((selected) => Number(selected) !== port))
        throw new Error('A conflicting remote debugging port was supplied.');
    if (!hasPlaceholder && ports.length === 0) args.push(`${DEFAULT_DEBUGGING_SWITCH}=${port}`);
    const executablePath = expand(launch.executable);
    const cwd = launch.cwd === undefined ? undefined : expand(launch.cwd);
    if (
        [executablePath, cwd].some(
            (value) => value?.includes(PORT_PLACEHOLDER) || value?.includes(DATA_DIRECTORY_PLACEHOLDER),
        )
    )
        throw new Error('Application paths cannot contain launch placeholders.');
    return {
        executablePath,
        arguments: args,
        ...(cwd === undefined ? {} : { cwd }),
        ...(env === undefined ? {} : { env }),
    };
}
