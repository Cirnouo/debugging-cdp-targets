# Desktop management contracts

- [commands.ts](commands.ts) owns the fixed channel, closed requests/commands and
    bridge types, plus the complete request and command parsers.
- [snapshots.ts](snapshots.ts) owns summaries, selected-operation evidence, failure
    values, both snapshot validators and their single shared field assertion.
- [AGENTS.md](AGENTS.md) defines exact pure dependencies, consumers and before-use rules.

Trusted dispatch, window/preload effects and renderer session state retain their
current [application](../../application/README.md) and
[interface](../../interface/README.md) owners. Whole regressions live in
[tests/desktop/contracts/](../../../tests/desktop/contracts/README.md).
