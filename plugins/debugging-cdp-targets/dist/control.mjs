import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// src/adapters/control-ipc.mjs
import { createHash } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";

// src/shared/constants.mjs
var CONTROL_TIMEOUT_MS = 45e3;
var MAX_HTTP_BYTES = 8 * 1024 * 1024;
var MAX_CONTROL_BYTES = 64 * 1024;
var TARGET_KINDS = Object.freeze(["chrome", "generic-cdp"]);
var DISPOSITIONS = Object.freeze(["Close", "Keep"]);
var PACKAGE_NAME = "chrome-devtools-mcp";
var PACKAGE_VERSION = "1.9.0";
var PACKAGE_SPEC = `${PACKAGE_NAME}@${PACKAGE_VERSION}`;

// src/adapters/control-ipc.mjs
function defaultControlEndpoint() {
  const user = os.userInfo();
  const identity = `${user.username}:${user.homedir}`;
  const suffix = createHash("sha256").update(identity).digest("hex").slice(0, 16);
  return process.platform === "win32" ? `\\\\.\\pipe\\debugging-cdp-targets-${suffix}` : path.join(os.tmpdir(), `debugging-cdp-targets-${suffix}.sock`);
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
        resolve(JSON.parse(received.trim()));
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

// src/interface/control-arguments.mjs
import { parseArgs } from "node:util";
var ACTIONS = /* @__PURE__ */ new Set(["status", "start", "switch", "stop"]);
function parseControlArguments(arguments_) {
  const [action, ...rest] = arguments_;
  if (!ACTIONS.has(action)) throw new Error("Unknown action. Use status, start, switch, or stop.");
  const parsed = parseArgs({
    args: rest,
    options: {
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
  const values = parsed.values;
  if (action === "status" && Object.keys(values).length > 0) throw new Error("Status takes no options.");
  if (["start", "switch"].includes(action) && !values["launch-command"]) {
    throw new Error("A --launch-command is required.");
  }
  if (["switch", "stop"].includes(action) && !["Close", "Keep"].includes(values.disposition)) {
    throw new Error("Choose --disposition Close or Keep.");
  }
  if (action === "start" && values.disposition) throw new Error("Start does not accept a disposition.");
  if (["status", "stop"].includes(action) && (values["launch-command"] || values["target-kind"] || values["base-port"])) {
    throw new Error(`${action} does not accept target launch options.`);
  }
  if (values["target-kind"] && !["chrome", "generic-cdp"].includes(values["target-kind"])) {
    throw new Error("Target kind must be chrome or generic-cdp.");
  }
  const basePort = values["base-port"] === void 0 ? 9222 : Number(values["base-port"]);
  if (!Number.isInteger(basePort) || basePort < 1 || basePort > 65535) throw new Error("Base port is invalid.");
  if (action === "status") return { action };
  if (action === "stop") return { action, disposition: values.disposition };
  return {
    action,
    launchCommand: values["launch-command"],
    targetKind: values["target-kind"] ?? "generic-cdp",
    basePort,
    ...action === "switch" ? { disposition: values.disposition } : {}
  };
}

// src/interface/control.mjs
async function main() {
  try {
    const request = parseControlArguments(process.argv.slice(2));
    const response = await sendControlRequest(defaultControlEndpoint(), request);
    process.stdout.write(`${JSON.stringify(response)}
`);
    if (!response.ok) process.exitCode = 1;
  } catch (error) {
    const message = ["ENOENT", "ECONNREFUSED", "EPIPE"].includes(error.code) ? "No active debugging-cdp-targets MCP connection." : error.message;
    process.stdout.write(`${JSON.stringify({ ok: false, error: message })}
`);
    process.exitCode = 1;
  }
}
await main();
