# Managed-session rules

Persist only the approved fields listed in shared/constants.mjs. Use
targetAdapter with lowercase chrome or generic-cdp. Never persist launch
arguments, headers, cookies, secrets, page data, or tool calls/results.
Detached records have daemonProcessId zero; active records require a positive
daemonProcessId. Invalid identities cannot be silently replaced or migrated.
