# Adapter rules

Do not import application or interface. Derive the Skill root from module URL.
Reject missing or invalid LOCALAPPDATA. State belongs in
%LOCALAPPDATA%\debugging-cdp-targets\state\session.json; CLI runtime/cache
belongs in the separate cache\chrome-devtools-cli subtree. Preserve the
Chrome profile at %USERPROFILE%\.cache\chrome-devtools-mcp\chrome-profile.

Delete only the state file and its now-empty state directory, using a
nonrecursive directory removal. Preserve cache and the user-data root.
Use shell-free hidden CLI and PowerShell subprocesses. Normal target windows
remain visible. Never suppress process/listener inspection failures into
absence. Never force-kill targets. Do not persist sensitive inputs or outputs.
