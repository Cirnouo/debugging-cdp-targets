import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// src/adapters/control-ipc.ts
import { createHash } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";

// src/shared/errors.ts
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function errorCode(error) {
  return isRecord(error) && typeof error.code === "string" ? error.code : void 0;
}

// src/domains/control-contract.ts
function validateIdentity(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))
    throw new Error(`A canonical lowercase UUID ${label} is required.`);
}
function fields(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Unknown control field.");
}
function validPort(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}
function parseControlRequest(value) {
  if (!isRecord(value)) throw new Error("Invalid control request.");
  validateIdentity(value.entryId, "entry ID");
  const entryId = value.entryId;
  const action = value.action;
  if (action === "status") {
    fields(value, ["action", "entryId", "connectionId"]);
    if (value.connectionId !== void 0) validateIdentity(value.connectionId, "connection ID");
    return { action, entryId, ...value.connectionId === void 0 ? {} : { connectionId: value.connectionId } };
  }
  if (action === "start") {
    fields(value, ["action", "entryId", "launchCommand", "targetKind", "basePort"]);
    if (typeof value.launchCommand !== "string" || !value.launchCommand.trim())
      throw new Error("A launch command is required.");
    if (value.targetKind !== void 0 && value.targetKind !== "chrome" && value.targetKind !== "generic-cdp")
      throw new Error("Unknown target kind.");
    if (value.basePort !== void 0 && !validPort(value.basePort)) throw new Error("Base port is invalid.");
    return {
      action,
      entryId,
      launchCommand: value.launchCommand,
      ...value.targetKind === void 0 ? {} : { targetKind: value.targetKind },
      ...value.basePort === void 0 ? {} : { basePort: value.basePort }
    };
  }
  if (action !== "restart" && action !== "stop" && action !== "end-task") throw new Error("Unknown control action.");
  fields(value, ["action", "entryId", "connectionId", "sessionId", ...action === "stop" ? ["disposition"] : []]);
  validateIdentity(value.connectionId, "connection ID");
  validateIdentity(value.sessionId, "session ID");
  if (action === "stop") {
    if (value.disposition !== "Close" && value.disposition !== "Keep") throw new Error("Choose Close or Keep.");
    return {
      action,
      entryId,
      connectionId: value.connectionId,
      sessionId: value.sessionId,
      disposition: value.disposition
    };
  }
  return { action, entryId, connectionId: value.connectionId, sessionId: value.sessionId };
}
function parseControlResponse(value) {
  if (!isRecord(value)) throw new Error("Invalid control response.");
  if (value.ok === false && typeof value.error === "string") {
    fields(value, ["ok", "error", "details"]);
    if (value.details !== void 0 && !isRecord(value.details)) throw new Error("Invalid error details.");
    return { ok: false, error: value.error, ...value.details === void 0 ? {} : { details: value.details } };
  }
  fields(value, ["ok", "result"]);
  const result = value.result;
  if (value.ok !== true || !isRecord(result)) throw new Error("Invalid control result.");
  if ("connections" in result) {
    fields(result, ["entryId", "connections"]);
    validateIdentity(result.entryId, "entry ID");
    if (!Array.isArray(result.connections)) throw new Error("Invalid connection list.");
    const connections = result.connections.map((connection) => {
      const parsed = parseControlResponse({ ok: true, result: connection });
      if (!parsed.ok || !("connectionId" in parsed.result) || parsed.result.entryId !== result.entryId)
        throw new Error("Invalid connection identity.");
      return parsed.result;
    });
    if (new Set(connections.map((connection) => connection.connectionId)).size !== connections.length)
      throw new Error("Duplicate connection identity.");
    return { ok: true, result: { entryId: result.entryId, connections } };
  }
  fields(result, [
    "entryId",
    "connectionId",
    "status",
    "sessionId",
    "port",
    "processId",
    "targetKind",
    "reason",
    "taskActive",
    "disposition",
    "pageIdsInvalidated"
  ]);
  validateIdentity(result.entryId, "entry ID");
  validateIdentity(result.connectionId, "connection ID");
  if (!["idle", "active", "lost", "closing", "close-failed"].includes(String(result.status)))
    throw new Error("Invalid target status.");
  if (result.status !== "idle" || result.sessionId !== void 0) validateIdentity(result.sessionId, "session ID");
  if ((result.status !== "idle" || result.port !== void 0) && !validPort(result.port))
    throw new Error("Invalid target port.");
  if ((result.status !== "idle" || result.processId !== void 0) && (typeof result.processId !== "number" || !Number.isSafeInteger(result.processId) || result.processId < 1))
    throw new Error("Invalid target process ID.");
  if ((result.status !== "idle" || result.targetKind !== void 0) && result.targetKind !== "chrome" && result.targetKind !== "generic-cdp")
    throw new Error("Invalid target kind.");
  if (result.reason !== void 0 && typeof result.reason !== "string") throw new Error("Invalid target reason.");
  if (result.disposition !== void 0 && result.disposition !== "Close" && result.disposition !== "Keep")
    throw new Error("Invalid disposition.");
  for (const key of ["taskActive", "pageIdsInvalidated"])
    if (result[key] !== void 0 && typeof result[key] !== "boolean") throw new Error("Invalid target marker.");
  return { ok: true, result };
}

// src/shared/constants.ts
var CONTROL_TIMEOUT_MS = 45e3;
var MAX_HTTP_BYTES = 8 * 1024 * 1024;
var MAX_CONTROL_BYTES = 64 * 1024;
var TARGET_KINDS = Object.freeze(["chrome", "generic-cdp"]);
var DISPOSITIONS = Object.freeze(["Close", "Keep"]);
var PACKAGE_NAME = "chrome-devtools-mcp";
var PACKAGE_VERSION = "1.10.1";
var PACKAGE_SPEC = `${PACKAGE_NAME}@${PACKAGE_VERSION}`;

// src/adapters/control-ipc.ts
function controlEndpoint(entryId, io = {}) {
  validateIdentity(entryId, "entry ID");
  const user = io.user ?? os.userInfo();
  const identity = `${user.username}:${user.homedir}`;
  if ((io.platform ?? process.platform) === "win32") {
    const suffix2 = createHash("sha256").update(identity).digest("hex").slice(0, 16);
    return `\\\\.\\pipe\\debugging-cdp-targets-${suffix2}-${entryId}`;
  }
  const suffix = createHash("sha256").update(JSON.stringify([user.username, user.homedir, entryId])).digest("hex").slice(0, 32);
  const endpoint = path.posix.join(io.tmpdir ?? os.tmpdir(), `dct-${suffix}.sock`);
  if (Buffer.byteLength(endpoint, "utf8") > 103)
    throw new Error(
      "Unix control endpoint exceeds the 103-byte socket path limit. Use a shorter temporary directory."
    );
  return endpoint;
}
async function sendControlRequest(endpoint, request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(endpoint);
    let received = "";
    socket.setEncoding("utf8");
    socket.setTimeout(CONTROL_TIMEOUT_MS, () => socket.destroy(new Error("Control request timed out.")));
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}
`));
    socket.on("data", (chunk) => {
      received += chunk;
    });
    socket.once("end", () => {
      try {
        const raw = JSON.parse(received.trim());
        resolve(parseControlResponse(raw));
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

// src/interface/control-arguments.ts
import { parseArgs } from "node:util";
function parseControlArguments(arguments_) {
  const [action, ...rest] = arguments_;
  if (!action || !["status", "start", "restart", "stop", "end-task"].includes(action))
    throw new Error("Unknown action. Use status, start, restart, stop, or end-task.");
  const parsed = parseArgs({
    args: rest,
    options: {
      "entry-id": { type: "string" },
      "connection-id": { type: "string" },
      "session-id": { type: "string" },
      "launch-command": { type: "string" },
      "target-kind": { type: "string" },
      "base-port": { type: "string" },
      disposition: { type: "string" }
    },
    strict: true,
    allowPositionals: false,
    tokens: true
  });
  const names = parsed.tokens.filter((token) => token.kind === "option").map((token) => token.name);
  if (new Set(names).size !== names.length) throw new Error("Duplicate control options are prohibited.");
  const request = { action };
  const mapping = {
    "entry-id": "entryId",
    "connection-id": "connectionId",
    "session-id": "sessionId",
    "launch-command": "launchCommand",
    "target-kind": "targetKind",
    "base-port": "basePort",
    disposition: "disposition"
  };
  for (const [name, value] of Object.entries(parsed.values)) {
    const key = mapping[name];
    if (key) request[key] = name === "base-port" ? /^[0-9]+$/.test(String(value)) ? Number(value) : NaN : value;
  }
  return parseControlRequest(request);
}

// src/interface/control.ts
async function main() {
  try {
    const request = parseControlArguments(process.argv.slice(2));
    const response = await sendControlRequest(controlEndpoint(request.entryId), request);
    process.stdout.write(`${JSON.stringify(response)}
`);
    if (!response.ok) process.exitCode = 1;
  } catch (error) {
    const message = ["ENOENT", "ECONNREFUSED", "EPIPE"].includes(errorCode(error) ?? "") ? "No active debugging-cdp-targets MCP connection." : errorMessage(error);
    process.stdout.write(`${JSON.stringify({ ok: false, error: message })}
`);
    process.exitCode = 1;
  }
}
await main();
