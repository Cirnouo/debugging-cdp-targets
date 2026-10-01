const PORT_PLACEHOLDER = '{port}';
const DEFAULT_DEBUGGING_SWITCH = '--remote-debugging-port';
const SHELL_OPERATORS = new Set(['&', '|', ';', '<', '>', '`', '\n', '\r']);

function tokenize(command: string) {
    const result = [];
    let value = '';
    let quote: string | null = null;
    let started = false;
    for (let index = 0; index < command.length; index += 1) {
        const character = command.charAt(index);
        if (quote === null && /\s/.test(character)) {
            if (started) result.push(value);
            value = '';
            started = false;
            continue;
        }
        if (character === '"' || character === "'") {
            if (quote === character) {
                quote = null;
            } else if (quote === null) {
                quote = character;
            } else {
                value += character;
            }
            started = true;
            continue;
        }
        if (quote === null && SHELL_OPERATORS.has(character)) {
            throw new Error('Shell operators are not accepted in launch commands.');
        }
        if (character === '\\' && command[index + 1] === '"') {
            value += '"';
            index += 1;
        } else {
            value += character;
        }
        started = true;
    }
    if (quote !== null) throw new Error('The launch command contains an unclosed quote.');
    if (started) result.push(value);
    return result;
}

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
        const match = argument.match(/^--remote-debugging-port(?:=|:)(.+)$/i);
        if (match) ports.push(match[1]);
        if (/^--remote-debugging-port$/i.test(argument)) ports.push(arguments_[index + 1]);
        if (/^--remote-debugging-pipe(?:=|$)/i.test(argument))
            throw new Error('Debugging pipe conflicts with a CDP port.');
    }
    if (ports.length > 1) throw new Error('Duplicate remote debugging port sources conflict.');
    return ports.length === 0 ? null : ports[0];
}

export function parseLaunchCommand({
    template,
    port,
    environment = {},
}: {
    template: string;
    port: number;
    environment?: Record<string, string | undefined>;
}) {
    if (typeof template !== 'string' || !template.trim()) throw new Error('A launch command is required.');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The CDP port is invalid.');
    const tokens = tokenize(template).map((token) => expandEnvironment(token, environment));
    if (tokens.length === 0 || !tokens[0]) throw new Error('The executable path is required.');
    const executable = tokens[0];
    const rawArguments = tokens.slice(1);
    if (executable.includes(PORT_PLACEHOLDER)) throw new Error('The executable cannot contain {port}.');
    const hasPlaceholder = rawArguments.some((argument) => argument.includes(PORT_PLACEHOLDER));
    const arguments_ = rawArguments.map((argument) => argument.replaceAll(PORT_PLACEHOLDER, String(port)));
    const fixedPort = explicitDebuggingPort(arguments_);
    if (fixedPort !== null && Number(fixedPort) !== port) {
        throw new Error('The launch command contains a conflicting remote debugging port.');
    }
    if (!hasPlaceholder && fixedPort === null) arguments_.push(`${DEFAULT_DEBUGGING_SWITCH}=${port}`);
    return { executable, arguments: arguments_ };
}
