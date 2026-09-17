import process from 'node:process';
import { fail } from '../shared/errors.mjs';
import { DEFAULT_BASE_PORT, DEFAULT_STARTUP_TIMEOUT_SECONDS, DEFAULT_PACKAGE_SPEC } from '../shared/constants.mjs';

export function parseCli(argv) {
    if (!Array.isArray(argv) || argv.length === 0) fail('ACTION_REQUIRED', 'Choose start, resume, invoke, status, or stop.');
    const action = String(argv[0]).toLowerCase();
    if (!['start', 'resume', 'invoke', 'status', 'stop'].includes(action)) fail('ACTION_INVALID', `Unknown action '${argv[0]}'.`);
    if (action === 'invoke') {
        const delimiter = argv.indexOf('--');
        if (delimiter < 0 || delimiter === argv.length - 1) fail('TOOL_ARGUMENT_REQUIRED', 'Invoke requires -- followed by official CLI tool arguments.');
        if (delimiter !== 1) fail('ARGUMENT_INVALID', 'Invoke does not accept options before --.');
        const toolArguments = argv.slice(delimiter + 1);
        if (/^--(?:category-?pwa|no-category-?pwa)(?:=|$)/i.test(toolArguments[0])) {
            fail('PWA_CATEGORY_UNSUPPORTED', 'The PWA category is unsupported with a verified browserUrl session.');
        }
        if (toolArguments[0].startsWith('--')) {
            fail('TOOL_COMMAND_INVALID', 'Invoke requires an official DevTools tool name before any options.');
        }
        if (['start', 'stop', 'status'].includes(toolArguments[0].toLowerCase())) {
            fail('TOOL_COMMAND_INVALID', 'Invoke accepts DevTools tools, not daemon lifecycle commands.');
        }
        for (const argument of toolArguments.slice(1)) {
            if (/^--(?:session-?id|browser-?url|ws-?endpoint|ws-?headers|auto-?connect|workspace|filesystem-?root|category-?extensions|usage-?statistics|performance-?crux|executable-?path|user-?data-?dir|chrome-?arg|ignore-?default-?chrome-?arg|isolated)(?:=|$)/i.test(argument)) {
                fail('RUNNER_ARGUMENT_CONFLICT', 'Invoke arguments must not override runner-owned daemon identity, connection, privacy, or workspace options.');
            }
            if (/^--(?:category-?pwa|no-category-?pwa)(?:=|$)/i.test(argument)) {
                fail('PWA_CATEGORY_UNSUPPORTED', 'The PWA category is unsupported with a verified browserUrl session.');
            }
        }
        return { action, toolArguments };
    }
    if (action === 'resume' || action === 'status') {
        if (argv.length !== 1) fail('ARGUMENT_INVALID', `${action} does not accept additional arguments.`);
        return { action };
    }

    const options = {};
    const repeated = { launchArguments: [], workspaces: [] };
    const takeValue = (index, inline) => {
        if (inline !== undefined) return { value: inline, next: index };
        if (index + 1 >= argv.length) fail('ARGUMENT_VALUE_REQUIRED', `A value is required for ${argv[index]}.`);
        return { value: argv[index + 1], next: index + 1 };
    };
    for (let index = 1; index < argv.length; index += 1) {
        const token = argv[index];
        const separator = token.indexOf('=');
        const name = separator >= 0 ? token.slice(0, separator) : token;
        const inline = separator >= 0 ? token.slice(separator + 1) : undefined;
        if (/^--category-?pwa$/i.test(name)) fail('PWA_CATEGORY_UNSUPPORTED', 'The PWA category is unsupported with a verified browserUrl session.');
        if (name === '--enable-extensions') {
            if (inline !== undefined) fail('ARGUMENT_INVALID', '--enable-extensions does not take a value.');
            options.enableExtensions = true;
            continue;
        }
        const valueResult = takeValue(index, inline);
        index = valueResult.next;
        const value = valueResult.value;
        switch (name) {
            case '--executable-path': options.executablePath = value; break;
            case '--target-adapter':
                if (!['chrome', 'generic-cdp'].includes(value)) fail('TARGET_ADAPTER_INVALID', 'Target adapter must be chrome or generic-cdp.');
                options.targetAdapter = value;
                break;
            case '--base-port': options.basePort = Number(value); break;
            case '--launch-argument': repeated.launchArguments.push(value); break;
            case '--workspace': repeated.workspaces.push(value); break;
            case '--startup-timeout-seconds': options.startupTimeoutSeconds = Number(value); break;
            case '--package-spec': options.packageSpec = value; break;
            case '--disposition': options.disposition = value; break;
            default: fail('ARGUMENT_INVALID', `Unknown argument '${name}'.`);
        }
    }
    if (action === 'start') {
        return {
            action,
            executablePath: options.executablePath,
            targetAdapter: options.targetAdapter,
            basePort: options.basePort ?? DEFAULT_BASE_PORT,
            launchArguments: repeated.launchArguments,
            workspaces: repeated.workspaces.length > 0 ? repeated.workspaces : [process.cwd()],
            enableExtensions: options.enableExtensions ?? false,
            startupTimeoutSeconds: options.startupTimeoutSeconds ?? DEFAULT_STARTUP_TIMEOUT_SECONDS,
            packageSpec: options.packageSpec ?? DEFAULT_PACKAGE_SPEC,
        };
    }
    return { action, disposition: options.disposition };
}
