# Domain boundaries

Keep decisions independent of environment I/O. Do not import filesystem,
child_process, HTTP, PowerShell, os, process, application, or adapters.
Receive probe results and process-presence evidence through parameters.
Use shared errors and constants; do not read environment variables here.
