import { isRecord } from '../shared/errors.ts';

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

const PORT_PLACEHOLDER = '{port}';
const DATA_DIRECTORY_PLACEHOLDER = '{dataDir}';
const DEFAULT_DEBUGGING_SWITCH = '--remote-debugging-port';

function expandEnvironment(argument: string, environment: Record<string, string | undefined>) {
    const expanded = argument
        .replace(/%([A-Za-z_][A-Za-z\d_]*)%/g, (_match: string, name: string) => {
            if (!(name in environment)) throw new Error(`Environment variable ${name} is undefined.`);
            return String(environment[name]);
        })
        .replace(/\$\{([A-Za-z_][A-Za-z\d_]*)\}/g, (_match: string, name: string) => {
            if (!(name in environment)) throw new Error(`Environment variable ${name} is undefined.`);
            return String(environment[name]);
        });
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

export function resolveLaunchDefinition(
    value: unknown,
    port: number,
    environment: Record<string, string | undefined>,
    dataDir?: string,
): LaunchDefinition {
    const launch = parseApplicationLaunch(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The CDP port is invalid.');
    if (dataDir !== undefined) stringValue(dataDir, 'data directory binding');
    const substitutePort = (argument: string) => argument.replaceAll(PORT_PLACEHOLDER, String(port));
    const substitute = (argument: string) =>
        expandEnvironment(argument, environment).replace(/\{port\}|\{dataDir\}/g, (placeholder) => {
            if (placeholder === PORT_PLACEHOLDER) return String(port);
            if (dataDir === undefined) throw new Error('The launch command requires a data directory binding.');
            return dataDir;
        });
    const raw = [...(launch.args ?? []), ...Object.values(launch.env ?? {})].map((argument) =>
        expandEnvironment(argument, environment),
    );
    const hasPlaceholder = raw.some((argument) => argument.includes(PORT_PLACEHOLDER));
    const args = (launch.args ?? []).map(substitute);
    const env =
        launch.env === undefined
            ? undefined
            : Object.fromEntries(Object.entries(launch.env).map(([key, setting]) => [key, substitute(setting)]));
    const argumentPort = explicitDebuggingPort(
        (launch.args ?? []).map((argument) => substitutePort(expandEnvironment(argument, environment))),
    );
    const environmentPorts: string[] = [];
    for (const template of Object.values(launch.env ?? {})) {
        const setting = substitutePort(expandEnvironment(template, environment));
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
    const executablePath = expandEnvironment(launch.executable, environment);
    const cwd = launch.cwd === undefined ? undefined : expandEnvironment(launch.cwd, environment);
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
