# Target rules

Accept only chrome and generic-cdp adapters. Chrome requires Google Chrome
file identity and the dedicated persistent Chrome profile. Generic CDP targets
receive only runner-owned loopback CDP switches plus caller launch arguments.
Reject overrides of runner-owned switches. Retry ports only after a verified
foreign-listener race. Validate root path, creation time, Windows session,
listener ownership, loopback exposure, product, and browser WebSocket identity.
