# English question catalogue

Use with [the common contract](question-contract.md). Each template contains the
complete localized title, facts, question, options and descriptions. Values are
internal answer identifiers. Preserve all wording, factual slots and option order.

```yaml dct-question-locale
language: en
fields:
    application:
        label: Application name
        constraint: Supply the actual application to launch for this request.
    version:
        label: Application version
        constraint: Supply the actual installed application version for this request.
    executable:
        label: Executable
        constraint: Supply the absolute path to the actual executable for this request.
    launch-args:
        label: Launch arguments
        constraint: Supply the complete argument array under the verified application contract; use no launch script.
    cwd:
        label: Working directory
        constraint: Supply the existing absolute working directory required for this launch.
    env:
        label: Environment
        constraint: Supply the environment key/value mapping required for this launch.
    existing-directory:
        label: Existing isolation directory
        constraint: Supply an existing directory's absolute path for direct use as the isolation directory.
    new-parent:
        label: Parent for a new isolation directory
        constraint: Supply an existing parent's absolute path; Plugin creates the isolation child.
    new-name:
        label: Previously specified child name
        constraint: "Correct only a name already supplied by User: use one unoccupied child name without path separators or parent segments."
    mcp-args:
        label: MCP configuration
        constraint: Supply the complete MCP argument array; replacement does not append arguments.
    task:
        label: Debugging task
        constraint: Supply the page or problem to inspect for this request.
    file-path:
        label: File path
        constraint: Supply the absolute file path needed by the currently authorized operation.
templates:
    isolation-intent:
        title: Isolation
        facts: "Application: {application}"
        question: Should this launch use data directory isolation?
        options:
            - value: data-dir
              label: Use data directory isolation
              description: Agent first verifies application isolation support; choosing isolation does not establish full support.
            - value: none
              label: Use no data directory isolation
              description: Agent skips isolation support research, directory selection and cleanup questions, and continues required launch and occupancy checks.
    partial-isolation:
        title: Partial
        facts: |-
            Application: {application}
            Verified isolation scope: {scope}
            Remaining production effects: {effects}
        question: Does User accept the partial isolation scope above?
        options:
            - value: data-dir
              label: Accept the partial isolation scope
              description: Agent continues directory selection within the verified scope above.
            - value: none
              label: Use no data directory isolation
              description: Agent skips directory selection and cleanup questions, and continues required launch and occupancy checks.
    directory-choice:
        title: Directory
        facts: "Application: {application}"
        question: How should the isolation data directory location be selected?
        options:
            - value: delegated
              label: Agent chooses location
              description: Agent selects an existing parent and Plugin creates a random child directory; User need not supply a path.
            - value: chrome-preset
              label: Chrome preset directory
              description: "Use the explicitly selected Chrome preset location: {preset_path}."
            - value: existing
              label: User specifies existing directory
              description: User supplies an existing directory's absolute path and Plugin uses it directly as the isolation directory; it may be empty or nonempty.
            - value: new
              label: User specifies parent directory
              description: User specifies an existing parent; Plugin creates an isolation child with a random name that does not conflict with existing child directories.
    existing-directory-input:
        title: Existing dir
        facts: |-
            Application: {application}
            Selected method: User specifies existing directory
        question: User should provide the existing directory's absolute path; the directory may be empty or nonempty.
        options: []
    new-directory-input:
        title: New location
        facts: |-
            Application: {application}
            Selected method: User specifies parent directory
        question: User should provide the existing parent's absolute path; Plugin creates an isolation child with a random name that does not conflict with existing child directories.
        options: []
    cleanup-existing:
        title: Cleanup
        facts: |-
            Application: {application}
            Selected directory's actual absolute path: {directory}
        question: Which cleanup policy should apply after final release of the selected isolation directory?
        options:
            - value: retain
              label: Retain the entire directory
              description: Retain the entire directory and all contents; Close/Keep does not change this policy.
            - value: delete-on-release
              label: Delete after final release
              description: Plugin waits until the application and relevant resources no longer use the directory, then deletes the entire directory and all contents, including pre-existing contents; Close/Keep does not change this policy.
    cleanup-new-named:
        title: Cleanup
        facts: |-
            Application: {application}
            Verified existing parent: {parent}
            Requested child name: {name}
            Selected directory: the requested child, not yet created
        question: Which cleanup policy should apply after final release of the selected isolation directory?
        options:
            - value: retain
              label: Retain the entire directory
              description: Retain the entire directory and all contents; Close/Keep does not change this policy.
            - value: delete-on-release
              label: Delete after final release
              description: Plugin waits until the application and relevant resources no longer use the directory, then deletes the entire directory and all contents, including pre-existing contents; Close/Keep does not change this policy.
    cleanup-new-preset:
        title: Cleanup
        facts: |-
            Application: {application}
            Selected Chrome preset isolation directory: {preset_path}
            Preset container parent: {preset_parent}
            Selected directory: the chrome-profile child, not yet created
            The containers may not exist; prepare them only after preset and cleanup selection under the bounded rules; containers remain after child cleanup
        question: Which cleanup policy should apply after final release of the selected isolation directory?
        options:
            - value: retain
              label: Retain the entire directory
              description: Retain the entire directory and all contents; Close/Keep does not change this policy.
            - value: delete-on-release
              label: Delete after final release
              description: Plugin waits until the application and relevant resources no longer use the directory, then deletes the entire directory and all contents, including pre-existing contents; Close/Keep does not change this policy.
    close-keep:
        title: End work
        facts: |-
            Application: {application}
            registrationId: {registration_id}
            connectionId: {connection_id}
            sessionId: {session_id}
            Established directory cleanup policy: {cleanup_policy}
        question: Before ending work on this target, how should the target be handled?
        options:
            - value: Close
              label: "Close: normal shutdown"
              description: Agent requests normal application shutdown and waits for actual exit; the established directory cleanup policy still applies.
            - value: Keep
              label: "Keep: retain application"
              description: Retain the live application and current upstream resources for later tasks; this does not cancel unfinished official execution or change directory cleanup policy.
    live-recovery:
        title: Recovery
        facts: |-
            Application: {application}
            registrationId: {registration_id}
            connectionId: {connection_id}
            sessionId: {session_id}
            Error code: {failure_code}
            Verified state: application still live
        question: How does User authorize Agent to handle this live connection?
        options:
            - value: restart
              label: Restart the live connection
              description: Normally close the application, wait for actual exit, and create a new session on the same connection with the same admitted configuration and directory under its fixed/automatic port policy; do not replay the failed call.
            - value: Close
              label: "Close: normal shutdown"
              description: Agent requests normal shutdown of the current application and waits for actual exit; the established directory cleanup policy still applies.
    exit-start:
        title: Target exit
        facts: |-
            Application: {application}
            Previous registrationId: {registration_id}
            Removed connectionId: {connection_id}
            Removed sessionId: {session_id}
            Verified state: actual application exit; old connection and session cannot be reused
        question: Does User authorize Agent to start a new target in the current chat to continue the current task?
        options:
            - value: start
              label: Authorize a new start
              description: Agent meets the applicable launch gates again, then launches a new target with new connection and session identities.
            - value: no-start
              label: Do not start another target
              description: Do not launch another target; the old connection and session remain invalid.
    tools-start:
        title: Start config
        facts: |-
            Application: {application}
            Required tools: {tool_names}
            Complete proposed mcpArgs: {mcp_args}
        question: Does User authorize Agent to start the target with the complete MCP configuration above?
        options:
            - value: start
              label: Authorize this start configuration
              description: After meeting applicable launch gates, Agent uses the complete proposed configuration, including its listed workspace access.
            - value: decline
              label: Do not enable these tools
              description: Do not start the target with this proposed configuration.
    tools-restart:
        title: Tool replacement
        facts: |-
            Application: {application}
            registrationId: {registration_id}
            connectionId: {connection_id}
            sessionId: {session_id}
            Required tools: {tool_names}
            Complete replacement mcpArgs: {mcp_args}
        question: Does User authorize Agent to normally Close this application, wait for actual exit, then start a new connection with the complete MCP configuration above?
        options:
            - value: restart
              label: Authorize Close and new start
              description: After normal Close and actual exit, Agent meets the applicable new-start gates and uses the complete successor configuration, including its workspace access; old connection and page identities expire.
            - value: decline
              label: Keep the current configuration
              description: Do not Close or create a successor to enable these tools.
    replace-launch:
        title: Launch args
        facts: |-
            Application: {application}
            registrationId: {registration_id}
            connectionId: {connection_id}
            sessionId: {session_id}
            Current application arguments: {old_args}
            Complete new start proposal: {start_proposal}
        question: Does User authorize Agent to normally Close the current target, wait for actual exit, then issue a new start under the proposal above?
        options:
            - value: close-start
              label: Authorize Close then new start
              description: The established cleanup policy still applies; start only after successful Close and renewed launch checks, without assuming a deleted directory can be reused.
            - value: decline
              label: Do not change launch arguments
              description: Do not close or relaunch the target for this proposal; preserve current application arguments.
    native-picker:
        title: File picker
        facts: |-
            Application: {application}
            registrationId: {registration_id}
            connectionId: {connection_id}
            sessionId: {session_id}
            Existing native file picker: {dialog_label}
            Verified limitation: Agent has no available native control capability
        question: User should handle this existing file picker and report the result.
        options:
            - value: completed
              label: User completed file selection
              description: User confirms the selection is complete; this answer does not authorize tool replay.
            - value: cancelled
              label: User cancelled file selection
              description: Agent stops repeating the import and does not trigger this file selection again.
    missing-input:
        title: Needed input
        facts: |-
            Application: {application}
            Missing necessary fields: {required_fields}
        question: User should provide the corresponding values for the necessary fields above.
        options: []
    application-input:
        title: Application
        facts: |-
            Pending preparation: launch a new managed target
            Missing necessary field: actual application name
        question: User should provide the actual application to launch for this request.
        options: []
    input-correction:
        title: Correction
        facts: |-
            Application: {application}
            Field requiring correction: {field_label}
            Field constraint: {field_constraint}
            Verified input issue: {validation_issue}
        question: User should provide the corrected field value; Agent preserves other supplied inputs without automatically switching directory operations or removing conflicting arguments.
        options: []
    answer-clarification:
        title: Clarify
        facts: |-
            Original question template: {template_id}
            Original User answer (quoted): {quoted_answer}
        question: The answer does not uniquely establish the original choice or necessary value; User should clarify that choice or supply the necessary value.
        options: []
    target-input:
        title: Target
        facts: "Current managed targets matching this request: {candidates}"
        question: User should identify the target for this operation from the targets above; Agent does not select the first target by default.
        options: []
    cancel-intent:
        title: Cancel scope
        facts: |-
            registrationId: {registration_id}
            operationId: {operation_id}
        question: Does User require cancellation of the current wait or of the operation itself?
        options:
            - value: cancel-wait
              label: Cancel only the current wait
              description: The operation continues running; cancelling the wait does not cancel the operation.
            - value: cancel-operation
              label: Cancel the operation itself
              description: Agent explicitly cancels the operation and handles acquired resources under the established lifecycle.
    cleanup-new-random:
        title: Cleanup
        facts: |-
            Application: {application}
            Verified existing parent: {parent}
            Selected directory: the random child Plugin will create under that parent, not yet created
        question: Which cleanup policy should apply after final release of the selected isolation directory?
        options:
            - value: retain
              label: Retain the entire directory
              description: Retain the entire directory and all contents; Close/Keep does not change this policy.
            - value: delete-on-release
              label: Delete after final release
              description: Plugin waits until the application and relevant resources no longer use the directory, then deletes the entire directory and all contents, including pre-existing contents; Close/Keep does not change this policy.
```
