<p align="center">
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="packaging/shared/assets/icon-dark.png">
        <source media="(prefers-color-scheme: light)" srcset="packaging/shared/assets/icon-light.png">
        <img src="packaging/shared/assets/icon.png" alt="Debugging CDP Targets 图标" width="128" height="128">
    </picture>
</p>

<h1 align="center">Debugging CDP Targets</h1>

<p align="center">
    启动独立的本地 CDP 目标，并通过官方 Chrome DevTools MCP Server 进行调试。
</p>

<p align="center">
    <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/status-0.1.0%20unreleased-07849e?style=flat&amp;labelColor=46545b" alt="状态：0.1.0 尚未发布"></a>
    <a href="docs/user-guide/compatibility.md"><img src="https://img.shields.io/badge/Node-24.x%20%E2%89%A5%2024.21.0-07849e?style=flat&amp;labelColor=46545b" alt="Node：稳定版 24.x，至少为 24.21.0"></a>
    <a href="https://github.com/ChromeDevTools/chrome-devtools-mcp"><img src="https://img.shields.io/badge/official%20Server-1.10.1-07849e?style=flat&amp;labelColor=46545b" alt="官方 Server：1.10.1"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-07849e?style=flat&amp;labelColor=46545b" alt="许可证：MIT"></a>
</p>

<p align="center">0.1.0 版本仍在开发中，尚未发布。</p>

<p align="center"><a href="README.md">English</a> · 简体中文</p>

<p align="center"><a href="#为什么使用它">为什么使用它</a> · <a href="#使用要求">使用要求</a> · <a href="#快速开始">快速开始</a> · <a href="#开始任务">开始任务</a> · <a href="#文档">文档</a></p>

## 为什么使用它

- **独立目标。** 启动新的本地应用，并验证其进程和 CDP 端点。
- **官方 DevTools。** 检查页面、截取屏幕截图、诊断网络与控制台问题，
    并分析性能。
- **独立连接。** 每个目标都有自己的 MCP 连接；关闭其中一个连接后，
    其他连接仍可继续使用。

## 使用要求

- PATH 中可用的 **Node 稳定版 24.x，至少为 24.21.0**。
- **支持 Plugin 的 Codex**，或 **Claude Code 2.1.283+**。
- **Chrome**，或其他提供**浏览器级 CDP 端点**的应用。

参阅[完整要求与已测试平台](docs/user-guide/compatibility.md)。

## 快速开始

### Codex

```powershell
codex plugin marketplace add Cirnouo/debugging-cdp-targets
codex plugin add debugging-cdp-targets@debugging-cdp-targets
```

在新对话中启用 Plugin 的 MCP 连接，并调用
`$debugging-cdp-targets`。参阅[安装详情](docs/user-guide/installation.md#codex)。

### Claude Code

```powershell
claude plugin marketplace add Cirnouo/debugging-cdp-targets
claude plugin install debugging-cdp-targets@debugging-cdp-targets
```

重启 Claude Code，并调用 `/debugging-cdp-targets:debugging-cdp-targets`。
参阅[安装详情](docs/user-guide/installation.md#claude-code)。

### 开始任务

调用所用宿主的 Skill 后，描述你的任务：

```text
启动一个独立的 Chrome 调试窗口，并打开 https://example.com。
检查页面的网络请求和控制台错误，并总结检查结果。
```

Agent 会在启动前确认你的数据目录隔离选择。在结束任务前，
它会询问你是要<strong>关闭（Close）</strong>目标，还是<strong>保留（Keep）</strong>目标以便后续继续工作。
有关目录选择、清理与目标存续时间，请参阅[详细工作流程](docs/user-guide/workflow.md)。

## 文档

浏览[用户指南](docs/user-guide/README.md)：

[安装](docs/user-guide/installation.md) · [兼容性](docs/user-guide/compatibility.md) · [工作流程](docs/user-guide/workflow.md) · [配置](docs/user-guide/configuration.md) · [隐私](docs/user-guide/privacy.md) · [故障排查](docs/user-guide/troubleshooting.md)

---

<p align="center">
    <sub><a href="CONTRIBUTING.md">参与贡献</a> · <a href="SECURITY.md">安全</a> · <a href="docs/README.md">文档索引</a></sub>
</p>
