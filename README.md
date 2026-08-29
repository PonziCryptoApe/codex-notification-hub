# Codex Notification Hub

一个可跨项目复用的本地 Codex 插件：语义规则由技能决定；`publish_notification` MCP 工具接收通道无关事件；钩子补获 `PermissionRequest` 并在 `Stop` 阶段做保守兜底；本地队列完成脱敏、去重、限流和重试；适配器最终发送消息。

第一阶段仅实现飞书自定义机器人 Webhook。通道接口已固定：Telegram 是下一个真实适配器，企业微信是后续正式适配器，个人微信仅保留实验性扩展点；三者均未实现，也不会被错误地当作可用通道。

## 事件与默认原则

支持 `NeedsConfirmation`、`Blocked`、`GoalCompleted`、`ExecutionFailed`、`PermissionRequired`。只通知需要用户决策、无法继续、明确成功、不可恢复失败或即将请求权限的状态。普通重试、可恢复测试失败和日志噪音默认不通知。

`dedupe_key` 是确定性的：`v1:<event-type>:<sha256(canonical(subject, source, normalized-summary))>`。同一去重窗口内只保留一次；事件内容不会包含源码、完整日志、提示词、凭据或原始工具输入。外发前还会清洗令牌、密码、URL 查询参数和过长文本。

## 通过 GitHub 分发与安装（需您主动执行）

仓库提交的是两个已打包的运行产物：`dist/server.js` 与 `dist/hook.js`。因此安装者**无需**运行 `npm install` 或构建 TypeScript；但其系统仍须具备 Node.js 20 或更高版本来运行 MCP 服务。

本仓库已提供正式 marketplace：`.agents/plugins/marketplace.json`。它将插件来源固定到 release tag，避免意外跟随 `main` 的变更。

安装者按以下顺序执行：

1. 添加固定到发布版的 marketplace：`codex plugin marketplace add PonziCryptoApe/codex-notification-hub --ref v0.1.2`。
2. 重启 ChatGPT desktop app，在 Plugins Directory 中选择 **Codex Notification Hub**，安装 `codex-notification-hub`。
3. 在插件详情启用 `notification-hub` MCP 服务；在 `/hooks` 中审阅并信任 `hooks/hooks.json`。
4. 开启一个**新任务**，调用“打开飞书通知设置”，在页面中填写 Webhook URL 和可选签名密钥；先保存，再进行受控测试。

不要把 marketplace、安装、启用钩子或真实发送视为本仓库开发的自动后续步骤；它们都会改变用户级状态或向外部服务发消息，必须由您确认后执行。

## 配置飞书

1. 在目标飞书群创建**自定义机器人**，建议在安全设置中启用签名校验。
2. 插件无配置时会安全启动，且所有通知通道关闭。在新任务中让 Codex 调用“打开飞书通知设置”，在页面中手动填写 Webhook URL 和可选签名密钥，再点击“保存并启用”。不需要手改 JSON 或设置环境变量。
3. 设置页把凭据保存到 `PLUGIN_DATA/config.json`：目录权限为 `0700`，文件权限为 `0600`，只允许当前本机用户读写。页面和工具结果绝不回显凭据；该文件不能提交、同步或备份到不可信位置。建议开启 macOS FileVault。
4. `.env` 与 `config.example.json` 仅供开发者进行无 UI 的环境变量部署；插件也兼容 `env:变量名` 引用。不要在 Codex 对话中粘贴 Webhook 或签名密钥。
5. MCP 服务会读取 `PLUGIN_DATA/config.json`。开发测试可设置 `CODEX_NOTIFICATION_HUB_CONFIG` 和 `CODEX_NOTIFICATION_HUB_DATA_DIR` 指向临时目录。

飞书签名使用其机器人 Webhook 约定：`timestamp + "\\n" + secret` 作为 HMAC-SHA256 密钥、空字节串作为数据，再以 Base64 发送为 `sign`。请求为 `interactive` 卡片。

## 路由、可靠性与安全

- `all`：每个已启用目标都尝试发送；整体成功仅代表至少一个通道成功。
- `first_success`：按配置顺序发送，首个成功即停止；适合未来多通道备援。
- 队列按目标限流（默认 1 秒），使用指数退避重试 4 次；4xx（除 408/429）不会重试。
- 队列与去重索引落在 `PLUGIN_DATA`；该目录是运行时数据，不应纳入版本控制或同步到不可信位置。
- 适配器绝不记录 Webhook URL、签名密钥、完整请求体或飞书响应正文。

## 开发与验证

```sh
npm install
npm test
npm run lint
npm run format:check
npm run validate:plugin
npm run validate:skill
```

测试使用内存中的假飞书服务，覆盖签名、卡片脱敏、重试、去重、两个路由策略和钩子事件，不发送真实飞书消息。

## 故障排查

- **服务没有出现**：确认已构建 `dist/server.js`、插件已安装，并在新任务启动后检查插件的 MCP 开关。
- **如何设置或清除飞书**：在对话中打开“飞书通知设置”页面；清除后本机配置会删除，插件不再外发。
- **钩子未执行**：插件钩子必须在 `/hooks` 审阅并信任；钩子是兜底，语义通知仍应优先调用 MCP 工具。
- **飞书返回签名失败**：检查本机的 `FEISHU_WEBHOOK_SECRET` 是否为该机器人的签名密钥、系统时间是否正确。
- **消息没有发送**：检查设置页是否显示“已启用”，配置文件是否在 `PLUGIN_DATA/config.json`，以及飞书群机器人是否仍有效。
- **被去重**：检查事件的 `dedupe_key` 或等待 `dedupeWindowSeconds` 过期；不要通过加入敏感内容规避去重。
