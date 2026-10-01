"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/adapters/hide-npm-console.ts
var hide_npm_console_exports = {};
__export(hide_npm_console_exports, {
  hiddenOptions: () => hiddenOptions
});
module.exports = __toCommonJS(hide_npm_console_exports);
var import_node_child_process = __toESM(require("node:child_process"), 1);
var import_node_module = require("node:module");
function hiddenOptions(options) {
  return { ...options, windowsHide: true };
}
if (process.platform === "win32") {
  const original = import_node_child_process.default.spawn;
  const hiddenSpawn = (command, arguments_, options) => Array.isArray(arguments_) ? original(command, arguments_, hiddenOptions(options)) : original(command, hiddenOptions(arguments_));
  import_node_child_process.default.spawn = hiddenSpawn;
  (0, import_node_module.syncBuiltinESMExports)();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  hiddenOptions
});
