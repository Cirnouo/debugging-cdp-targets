import path from 'node:path';
import { APPROVED_STATE_FIELDS, DEFAULT_PACKAGE_SPEC, SESSION_SCHEMA_VERSION } from '../../shared/constants.mjs';
import { fail } from '../../shared/errors.mjs';
import { parseSemver, validatePackageSpec } from '../../shared/semver.mjs';
import { isIntegerInRange } from '../../shared/values.mjs';
import { extractBrowserMajor, validateWebSocketDebuggerUrl } from '../cdp-target/policy.mjs';

export function createSessionRecord(input) {
    const record = {};
    for (const key of APPROVED_STATE_FIELDS) record[key] = input[key];
    if (record.schemaVersion !== SESSION_SCHEMA_VERSION)
        fail('STATE_SCHEMA_INVALID', 'The session schema version is invalid.');
    if (!['active', 'detached'].includes(record.status)) fail('STATE_STATUS_INVALID', 'The session status is invalid.');
    if (!['chrome', 'generic-cdp'].includes(record.targetAdapter))
        fail('STATE_TARGET_ADAPTER_INVALID', 'The session target adapter is invalid.');
    if (typeof record.executablePath !== 'string' || !path.isAbsolute(record.executablePath))
        fail('STATE_EXECUTABLE_INVALID', 'The recorded executable path must be absolute.');
    if (!Number.isInteger(record.rootProcessId) || record.rootProcessId <= 0)
        fail('STATE_ROOT_PROCESS_INVALID', 'The recorded root process ID is invalid.');
    if (!isIntegerInRange(record.port, 1, 65535)) fail('STATE_PORT_INVALID', 'The recorded CDP port is invalid.');
    if (typeof record.browserProduct !== 'string' || record.browserProduct.length === 0)
        fail('STATE_BROWSER_PRODUCT_INVALID', 'The recorded browser product is invalid.');
    if (
        !Number.isInteger(record.browserMajorVersion) ||
        record.browserMajorVersion <= 0 ||
        extractBrowserMajor(record.browserProduct) !== record.browserMajorVersion
    ) {
        fail('STATE_BROWSER_VERSION_INVALID', 'The recorded browser major version does not match the browser product.');
    }
    validateWebSocketDebuggerUrl(record.webSocketDebuggerUrl, record.port);
    validatePackageSpec(record.requestedPackageSpec);
    parseSemver(record.resolvedPackageVersion);
    if (
        record.requestedPackageSpec !== DEFAULT_PACKAGE_SPEC &&
        record.requestedPackageSpec !== `chrome-devtools-mcp@${record.resolvedPackageVersion}`
    ) {
        fail(
            'STATE_PACKAGE_VERSION_MISMATCH',
            'The requested exact package version does not match the resolved package version.',
        );
    }
    if (typeof record.extensionsEnabled !== 'boolean')
        fail('STATE_EXTENSIONS_INVALID', 'The recorded extension mode must be boolean.');
    if (!Array.isArray(record.workspaces) || record.workspaces.length === 0)
        fail('STATE_WORKSPACES_INVALID', 'The recorded workspace list is invalid.');
    for (const workspace of record.workspaces) {
        if (typeof workspace !== 'string' || !path.isAbsolute(workspace))
            fail('STATE_WORKSPACES_INVALID', 'Every recorded workspace must be absolute.');
    }
    if (
        typeof record.startedAtUtc !== 'string' ||
        !Number.isFinite(Date.parse(record.startedAtUtc)) ||
        !/Z$/i.test(record.startedAtUtc)
    ) {
        fail('STATE_START_TIME_INVALID', 'The recorded process start time is invalid.');
    }
    if (record.status === 'active' && (!Number.isInteger(record.daemonProcessId) || record.daemonProcessId <= 0)) {
        fail('STATE_DAEMON_PROCESS_INVALID', 'An active session requires a positive daemon process ID.');
    }
    if (record.status === 'detached' && record.daemonProcessId !== 0) {
        fail('STATE_DAEMON_PROCESS_INVALID', 'A detached session must record daemon process ID zero.');
    }
    return record;
}
