# Common question contract

The YAML is an instruction contract, not a tool input or a runtime API.
`fields` lists necessary field IDs in registry order; `triggers` names the
observable question entrances; `notice_only` never selects a question.
`templates` declares each canonical template ID and its ordered factual variables.
Read this common contract before a needed question, then reuse it within the task.
Load only the current conversation language catalogue for localized fields and
complete User-facing templates.

Variables are facts, never new questions, options or authorization:

- `application`: the application and applicable verified version for this launch.
- `scope`, `effects`: verified isolated state and remaining production effects.
- `preset_path`: the resolved absolute Chrome preset location, also used for
    the selected absent preset's planned leaf in `cleanup-new-preset`.
- `preset_parent`: the resolved absolute preset container parent; containers may
    still be absent when `cleanup-new-preset` is asked before bounded preparation.
- `directory`: the selected existing directory's resolved actual absolute path.
- `parent`: the verified existing absolute parent, not a future child path.
- `name`: the explicitly requested new leaf name, not a guessed random name.
- `registration_id`, `connection_id`, `session_id`: the retained public registration ID and verified affected route. Never use the
    private bearer as a question variable. For actual exit, connection/session
    identify the removed route and cannot be reused.
- `cleanup_policy`: the established `retain`, `delete-on-release`, or `none`
    when no isolation directory was acquired; this question does not change it.
- `failure_code`: the bounded reported error code, not raw error/page content.
- `tool_names`, `mcp_args`: verified tool names and complete proposed replacement
    MCP argument array, including workspace grants; never an unexplained delta.
- `old_args`, `start_proposal`: current argv and the complete proposed structured
    start (launch, isolation, MCP configuration and fresh request identity).
- `dialog_label`: the observed native picker label belonging to the affected app.
- `required_fields`: missing necessary fields, in `fields` registry order, each
    using its fixed localized label and constraint, excluding correction-only
    `fields.new-name`. Investigate read-only first;
    never ask for discoverable information, optional names or reasons. Absence
    from User input is not unresolved evidence: derive launch arguments from the
    verified startup/CDP contract. Complete startup evidence needs no User-supplied
    args and no `missing-input` question merely because User did not supply them.
- `field_label`, `field_constraint`: one matched localized pair from `fields`.
- `validation_issue`: the verified field-specific rule violation, not a guessed
    error code, raw error, new question or proposed remedy.
- `template_id`, `quoted_answer`: the original catalogue ID and User's ambiguous
    answer as quoted data; repeat that original template unchanged if needed.
- `candidates`: verified current target names and public registration/connection/session IDs,
    displayed with those fixed field labels, in status order; no invented targets.
- `operation_id`: the operation actually implicated by an ambiguous cancel request.

```yaml dct-question-contract
fields:
    - application
    - version
    - executable
    - launch-args
    - cwd
    - env
    - existing-directory
    - new-parent
    - new-name
    - mcp-args
    - task
    - file-path
triggers:
    isolation-needed: isolation-intent
    partial-support: partial-isolation
    directory-needed: directory-choice
    existing-path-missing: existing-directory-input
    new-parent-missing: new-directory-input
    new-named-parent-missing: missing-input
    cleanup-existing-needed: cleanup-existing
    cleanup-new-named-needed: cleanup-new-named
    cleanup-new-random-needed: cleanup-new-random
    cleanup-new-preset-needed: cleanup-new-preset
    task-ending: close-keep
    live-connection-failure: live-recovery
    active-unexpected-exit: exit-start
    tools-before-start: tools-start
    tools-on-live-connection: tools-restart
    launch-args-change: replace-launch
    native-picker-unavailable: native-picker
    required-input-unresolved: missing-input
    application-unresolved: application-input
    invalid-input: input-correction
    ambiguous-answer: answer-clarification
    ambiguous-target: target-input
    ambiguous-cancellation: cancel-intent
notice_only:
    - unsupported-isolation
    - unknown-isolation
    - unexpressible-isolation
    - occupied-or-unverifiable
    - existing-nonempty-retain
    - unsupported-tool
    - expected-exit
    - inactive-exit
    - close-wait
    - version-mismatch
templates:
    isolation-intent:
        variables:
            - application
    partial-isolation:
        variables:
            - application
            - scope
            - effects
    directory-choice:
        variables:
            - application
            - preset_path
    existing-directory-input:
        variables:
            - application
    new-directory-input:
        variables:
            - application
    cleanup-existing:
        variables:
            - application
            - directory
    cleanup-new-named:
        variables:
            - application
            - parent
            - name
    cleanup-new-preset:
        variables:
            - application
            - preset_path
            - preset_parent
    close-keep:
        variables:
            - application
            - registration_id
            - connection_id
            - session_id
            - cleanup_policy
    live-recovery:
        variables:
            - application
            - registration_id
            - connection_id
            - session_id
            - failure_code
    exit-start:
        variables:
            - application
            - registration_id
            - connection_id
            - session_id
    tools-start:
        variables:
            - application
            - tool_names
            - mcp_args
    tools-restart:
        variables:
            - application
            - registration_id
            - connection_id
            - session_id
            - tool_names
            - mcp_args
    replace-launch:
        variables:
            - application
            - registration_id
            - connection_id
            - session_id
            - old_args
            - start_proposal
    native-picker:
        variables:
            - application
            - registration_id
            - connection_id
            - session_id
            - dialog_label
    missing-input:
        variables:
            - application
            - required_fields
    application-input:
        variables: []
    input-correction:
        variables:
            - application
            - field_label
            - field_constraint
            - validation_issue
    answer-clarification:
        variables:
            - template_id
            - quoted_answer
    target-input:
        variables:
            - candidates
    cancel-intent:
        variables:
            - registration_id
            - operation_id
    cleanup-new-random:
        variables:
            - application
            - parent
```
