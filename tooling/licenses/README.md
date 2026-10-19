# Bundled license notices

- `bundled-notices.ts` collects complete original notices from actual App and research
  fixture bundle inputs. It owns package roots, canonical validation, reviewed SDK
  source/map/vendor checks, deduplication and deterministic notice bytes.
- `canonical-inputs.ts` contains independently reviewed package identities and
  license hashes shared by that collector and the standalone security notice builder.
- `reviewed-vendors.json` retains fixed registry provenance, reviewed SDK bundle/map
  fingerprints and exact vendor license evidence. It is not a generated cache.

Builders call the collector directly. It does not import builders or payload auditors.
Standalone security preserves original untrimmed YAML/semver notice bytes separately.
Follow cumulative [tooling rules](../AGENTS.md) and the
[supply-chain policy](../../docs/policies/supply-chain.md); never refresh evidence automatically.
