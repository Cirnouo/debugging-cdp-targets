export const SESSION_SCHEMA_VERSION = 1;
export const DEFAULT_BASE_PORT = 9222;
export const DEFAULT_STARTUP_TIMEOUT_SECONDS = 20;
export const DEFAULT_PACKAGE_SPEC = 'chrome-devtools-mcp@latest';
export const MINIMUM_EXTENSION_CHROME_MAJOR = 149;
export const MINIMUM_EXTENSION_MCP_VERSION = '0.22.0';
export const OFFICIAL_NPM_REGISTRY = 'https://registry.npmjs.org/';
export const REQUIRED_EXTENSION_COMMANDS = Object.freeze([
    'install_extension',
    'list_extensions',
    'reload_extension',
    'trigger_extension_action',
    'uninstall_extension',
]);
export const POLL_INTERVAL_MILLISECONDS = 200;
export const SEMVER_PATTERN =
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const APPROVED_STATE_FIELDS = Object.freeze([
    'schemaVersion',
    'status',
    'targetAdapter',
    'executablePath',
    'rootProcessId',
    'port',
    'browserProduct',
    'browserMajorVersion',
    'webSocketDebuggerUrl',
    'requestedPackageSpec',
    'resolvedPackageVersion',
    'extensionsEnabled',
    'workspaces',
    'startedAtUtc',
    'daemonProcessId',
]);
