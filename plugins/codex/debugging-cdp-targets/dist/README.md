# Bundled runtime

Each host payload contains this same complete runtime and official release.
Every resource resolves inside its own installed payload.

`mcp-bootstrap.mjs` is generated from source and needs no Plugin-local install.
`windows-cdp-helper.ps1` provides OS evidence. `windows-native-helper.ps1` and
`windows-native-process.cs` provide maintained Windows launch/permission/close
support; the helper compiles its bundled C# in memory using Windows .NET.
`THIRD-PARTY-NOTICES.txt` contains licenses for all bundled third-party packages,
including the official MCP SDK packages, their dependencies, and verified vendored code.
Do not edit generated files directly; rebuild with pnpm build:plugin.

`official-server/` contains the complete unchanged official npm release, including
its Apache-2.0 LICENSE, bundled vendor notices, resources and published skills.
The build checks every published file against maintained release evidence; pnpm's
installation-only bin shims are never copied. This verified third-party subtree
retains upstream formatting and documentation. Its JavaScript is syntax-checked.
