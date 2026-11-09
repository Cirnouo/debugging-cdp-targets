# Fixed management assets

- [asset-policy.ts](asset-policy.ts) owns the App URL and fixed supplied URL/method/
    origin admission rules; it performs no resource acquisition.
- [AGENTS.md](AGENTS.md) defines this exact pure role and before-use obligations.

Main/bootstrap/lifecycle and management-window composition remain in
[interface/](../../interface/README.md); no future lifecycle owner is delivered here.
The complete admission case lives in [tests/desktop/main/](../../../tests/desktop/main/README.md).
