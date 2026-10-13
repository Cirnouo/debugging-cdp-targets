# Chinese question catalogue

Use with [the common contract](question-contract.md). Each template contains the
complete localized title, facts, question, options and descriptions. Values are
internal answer identifiers. Preserve all wording, factual slots and option order.

```yaml dct-question-locale
language: zh
fields:
    application:
        label: 应用名称
        constraint: 提供本次需要启动的实际应用名称。
    version:
        label: 应用版本
        constraint: 提供本次实际安装的应用版本。
    executable:
        label: 可执行文件
        constraint: 提供本次实际可执行文件的绝对路径。
    launch-args:
        label: 启动参数
        constraint: 提供符合已核实应用契约的完整参数数组；不使用启动脚本。
    cwd:
        label: 工作目录
        constraint: 提供本次启动所需的现有工作目录绝对路径。
    env:
        label: 环境变量
        constraint: 提供本次启动所需的环境变量键值映射。
    existing-directory:
        label: 已有隔离目录
        constraint: 提供已有目录的绝对路径，直接用作隔离目录。
    new-parent:
        label: 新隔离目录的父目录
        constraint: 提供现有父目录的绝对路径；插件创建隔离子目录。
    new-name:
        label: 已指定的子目录名称
        constraint: 仅纠正用户已明确提供的名称：使用未占用的单个子目录名称，不含路径分隔符或父目录段。
    mcp-args:
        label: MCP 配置
        constraint: 提供完整 MCP 参数数组；替换配置不是追加参数。
    task:
        label: 调试任务
        constraint: 提供本次需要检查的页面或问题。
    file-path:
        label: 文件路径
        constraint: 提供当前已授权操作所需文件的绝对路径。
templates:
    isolation-intent:
        title: 隔离意图
        facts: 应用：{application}
        question: 本次启动是否使用数据目录隔离？
        options:
            - value: data-dir
              label: 使用数据目录隔离
              description: Agent 先核实应用的隔离支持范围；选择隔离不代表应用支持完整隔离。
            - value: none
              label: 不使用数据目录隔离
              description: Agent 跳过隔离支持研究、隔离目录选择和清理提问，继续必要的启动与占用检查。
    partial-isolation:
        title: 部分隔离
        facts: |-
            应用：{application}
            已验证的隔离范围：{scope}
            剩余生产影响：{effects}
        question: 用户是否接受上述部分隔离范围？
        options:
            - value: data-dir
              label: 接受上述部分隔离范围
              description: Agent 按上述已验证范围继续隔离目录选择。
            - value: none
              label: 不使用数据目录隔离
              description: Agent 跳过隔离目录选择和清理提问，继续必要的启动与占用检查。
    directory-choice:
        title: 目录位置
        facts: 应用：{application}
        question: 隔离数据目录采用哪种位置选择方式？
        options:
            - value: delegated
              label: Agent 自选位置
              description: Agent 选择现有父目录，插件创建随机子目录；用户无需提供路径。
            - value: chrome-preset
              label: Chrome 预设目录
              description: 使用明确选中的 Chrome 预设位置：{preset_path}。
            - value: existing
              label: 用户指定已有目录
              description: 用户提供已有目录的绝对路径，插件直接将该目录用作隔离目录；目录可以为空或非空。
            - value: new
              label: 用户指定父目录
              description: 用户指定现有父目录，插件在其中创建随机命名且不与已有子目录重名的隔离目录。
    existing-directory-input:
        title: 已有目录
        facts: |-
            应用：{application}
            已选方式：用户指定已有目录
        question: 请用户提供已有目录的绝对路径；该目录可以为空或非空。
        options: []
    new-directory-input:
        title: 新目录位置
        facts: |-
            应用：{application}
            已选方式：用户指定父目录
        question: 请用户提供现有父目录的绝对路径；插件在其中创建随机命名且不与已有子目录重名的隔离目录。
        options: []
    cleanup-existing:
        title: 目录清理
        facts: |-
            应用：{application}
            选定目录的真实绝对路径：{directory}
        question: 选定隔离目录最终释放后采用哪种清理策略？
        options:
            - value: retain
              label: 保留整个目录
              description: 保留整个目录及全部内容；Close/Keep 不改变此策略。
            - value: delete-on-release
              label: 释放后删除整个目录
              description: 插件等待应用及相关资源不再使用目录后，删除整个目录及全部内容，包括预先存在的内容；Close/Keep 不改变此策略。
    cleanup-new-named:
        title: 目录清理
        facts: |-
            应用：{application}
            已验证的现有父目录：{parent}
            指定子目录名称：{name}
            选定目录：尚未创建的指定子目录
        question: 选定隔离目录最终释放后采用哪种清理策略？
        options:
            - value: retain
              label: 保留整个目录
              description: 保留整个目录及全部内容；Close/Keep 不改变此策略。
            - value: delete-on-release
              label: 释放后删除整个目录
              description: 插件等待应用及相关资源不再使用目录后，删除整个目录及全部内容，包括预先存在的内容；Close/Keep 不改变此策略。
    cleanup-new-preset:
        title: 目录清理
        facts: |-
            应用：{application}
            选定的 Chrome 预设隔离目录：{preset_path}
            预设容器父目录：{preset_parent}
            选定目录：尚未创建的 chrome-profile 子目录
            容器可能尚不存在，仅在选定预设和清理策略后按规则准备；容器在子目录清理后保留
        question: 选定隔离目录最终释放后采用哪种清理策略？
        options:
            - value: retain
              label: 保留整个目录
              description: 保留整个目录及全部内容；Close/Keep 不改变此策略。
            - value: delete-on-release
              label: 释放后删除整个目录
              description: 插件等待应用及相关资源不再使用目录后，删除整个目录及全部内容，包括预先存在的内容；Close/Keep 不改变此策略。
    close-keep:
        title: 结束目标工作
        facts: |-
            应用：{application}
            entryId：{entry_id}
            connectionId：{connection_id}
            sessionId：{session_id}
            既定目录清理策略：{cleanup_policy}
        question: 结束本次目标工作前，用户要求如何处理该目标？
        options:
            - value: Close
              label: Close：正常关闭
              description: Agent 请求正常关闭应用并等待实际退出；既定目录清理策略继续生效。
            - value: Keep
              label: Keep：保留应用
              description: 保留存活应用及当前上游资源供后续任务使用；此选择不恢复已隔离的工具，也不改变目录清理策略。
    live-recovery:
        title: 活连接恢复
        facts: |-
            应用：{application}
            entryId：{entry_id}
            connectionId：{connection_id}
            sessionId：{session_id}
            错误代码：{failure_code}
            已验证状态：应用仍存活
        question: 用户授权 Agent 如何处理该活连接？
        options:
            - value: restart
              label: Restart：重启活连接
              description: 正常关闭当前应用并等待实际退出，以相同参数、目录和原端口在同一连接创建新会话；不重放失败调用。
            - value: Close
              label: Close：正常关闭
              description: Agent 请求正常关闭当前应用并等待实际退出；既定目录清理策略继续生效。
    exit-start:
        title: 目标已退出
        facts: |-
            应用：{application}
            旧 entryId：{entry_id}
            已移除 connectionId：{connection_id}
            已移除 sessionId：{session_id}
            已验证状态：应用实际退出，旧连接和会话不可复用
        question: 用户是否授权 Agent 在当前聊天重新 start 目标以继续当前任务？
        options:
            - value: start
              label: 授权重新 start
              description: Agent 重新满足适用启动门槛后启动新目标，取得新的连接和会话身份。
            - value: no-start
              label: 不重新启动
              description: 不启动新目标；旧连接和会话保持失效。
    tools-start:
        title: 启动工具配置
        facts: |-
            应用：{application}
            所需工具：{tool_names}
            完整拟议 mcpArgs：{mcp_args}
        question: 用户是否授权 Agent 使用上述完整 MCP 配置启动目标？
        options:
            - value: start
              label: 授权使用上述配置启动
              description: Agent 满足适用启动门槛后使用完整拟议配置，包括其中列出的工作区访问范围。
            - value: decline
              label: 暂不启用所需工具
              description: 不使用本次拟议配置启动目标。
    tools-restart:
        title: 重启工具配置
        facts: |-
            应用：{application}
            entryId：{entry_id}
            connectionId：{connection_id}
            sessionId：{session_id}
            所需工具：{tool_names}
            完整替换 mcpArgs：{mcp_args}
        question: 用户是否授权 Agent 使用上述完整 MCP 配置重启该活连接？
        options:
            - value: restart
              label: 授权替换配置并重启
              description: 完整替换 MCP 配置及工作区访问范围，沿用应用参数、目录和原端口；新会话使旧页面 ID 失效。
            - value: decline
              label: 保持当前配置
              description: 不执行本次重启或启用所需工具。
    replace-launch:
        title: 变更启动参数
        facts: |-
            应用：{application}
            entryId：{entry_id}
            connectionId：{connection_id}
            sessionId：{session_id}
            当前应用参数：{old_args}
            完整新 start 提案：{start_proposal}
        question: 用户是否授权 Agent 正常 Close 当前目标，等待实际退出后按上述提案执行新的 start？
        options:
            - value: close-start
              label: 授权 Close 后重新 start
              description: 既定目录清理策略继续生效；Close 成功且启动门槛重新满足后才启动新目标，不默认复用已删除目录。
            - value: decline
              label: 不执行本次参数变更
              description: 不因本次提案关闭或重新启动目标，保留当前应用参数。
    native-picker:
        title: 原生弹窗协助
        facts: |-
            应用：{application}
            entryId：{entry_id}
            connectionId：{connection_id}
            sessionId：{session_id}
            现有原生文件选择框：{dialog_label}
            已验证限制：Agent 无可用原生操作能力
        question: 请用户处理该现有文件选择框并告知结果。
        options:
            - value: completed
              label: 用户已完成文件选择
              description: 用户确认已完成选择；此答复不授权重放工具调用。
            - value: cancelled
              label: 用户已取消文件选择
              description: Agent 停止重复导入，不再次触发该文件选择操作。
    missing-input:
        title: 补充必要信息
        facts: |-
            应用：{application}
            尚缺必要字段：{required_fields}
        question: 请用户提供上述必要字段的对应值。
        options: []
    application-input:
        title: 明确应用
        facts: |-
            待准备操作：启动新的受管目标
            尚缺必要字段：实际应用名称
        question: 请用户提供本次需要启动的实际应用名称。
        options: []
    input-correction:
        title: 纠正输入
        facts: |-
            应用：{application}
            待纠正字段：{field_label}
            字段约束：{field_constraint}
            已验证的输入问题：{validation_issue}
        question: 请用户提供该字段的修正值；Agent 保留其他已提供输入，不自动切换目录操作或删除冲突参数。
        options: []
    answer-clarification:
        title: 澄清回答
        facts: |-
            原问题模板：{template_id}
            用户原回答（引用）：{quoted_answer}
        question: 该回答不能唯一确定原问题的选择或必要值；请用户明确原问题的选择或补全必要值。
        options: []
    target-input:
        title: 选择目标
        facts: 可对应本次请求的当前受管目标：{candidates}
        question: 请用户从上述目标中明确本次操作的目标；Agent 不默认选择第一个目标。
        options: []
    cancel-intent:
        title: 取消范围
        facts: |-
            entryId：{entry_id}
            operationId：{operation_id}
        question: 用户要求取消当前等待，还是取消该操作本身？
        options:
            - value: cancel-wait
              label: 仅取消当前等待
              description: 操作继续运行；取消等待不等于取消操作。
            - value: cancel-operation
              label: 取消操作本身
              description: Agent 显式取消操作，按既定生命周期处理已取得的资源。
    cleanup-new-random:
        title: 目录清理
        facts: |-
            应用：{application}
            已验证的现有父目录：{parent}
            选定目录：插件将在该父目录下随机创建的子目录，尚未创建
        question: 选定隔离目录最终释放后采用哪种清理策略？
        options:
            - value: retain
              label: 保留整个目录
              description: 保留整个目录及全部内容；Close/Keep 不改变此策略。
            - value: delete-on-release
              label: 释放后删除整个目录
              description: 插件等待应用及相关资源不再使用目录后，删除整个目录及全部内容，包括预先存在的内容；Close/Keep 不改变此策略。
```
