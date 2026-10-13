# Skill references

- `question-contract.md` owns ordered field IDs, triggers, notice-only cases,
    canonical template variables and factual variable explanations. Read it before
    a needed question and reuse it for subsequent questions within the task.
- `questions.zh.md` owns Chinese field wording and all complete Chinese templates.
- `questions.en.md` owns English field wording and all complete English templates.
- `tool-configuration.md` owns TOOL_NOT_ENABLED, tool enablement, complete
    replacement mcpArgs and workspace/configuration access. Read it on a requested
    unavailable tool and before changing enablement/workspace access or inspecting
    configuration sources/diagnostics.
- `screenshot-compatibility.md` owns feature syntax/conflicts, verified generic
    carriers and screenshot argv replacement. Read it before correcting feature
    argv, applying generic compatibility or replacing a screenshot launch.
- `recovery-and-events.md` owns disposal/retry specifics, live restart, Hooks and
    operation notice grouping/acknowledgment/unread/status-selection constraints.
    Read it before those operations or interpreting the corresponding notices.

Follow the language choice in `../SKILL.md`. Load only the current language
when a question is needed; do not actively read both catalogues. Load a conditional
operation reference only at its matching before-action trigger; the main workflow
remains in `../SKILL.md`.
