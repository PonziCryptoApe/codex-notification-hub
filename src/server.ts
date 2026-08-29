import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  clearSettings,
  readSettingsStatus,
  saveFeishuSettings,
} from "./config.js";
import { SETUP_UI_URI, setupUiHtml } from "./setup-ui.js";
import { EVENT_TYPES } from "./types.js";
import { hubFromEnvironment } from "./hub.js";

const server = new McpServer({
  name: "codex-notification-hub",
  version: "0.1.3",
});
const configPath = process.env.CODEX_NOTIFICATION_HUB_CONFIG;
if (!configPath) throw new Error("需要 CODEX_NOTIFICATION_HUB_CONFIG");

let hubPromise = hubFromEnvironment();

server.registerResource(
  "notification-settings",
  SETUP_UI_URI,
  {},
  async () => ({
    contents: [
      {
        uri: SETUP_UI_URI,
        mimeType: "text/html;profile=mcp-app",
        text: setupUiHtml,
        _meta: { ui: { prefersBorder: true } },
      },
    ],
  }),
);

server.registerTool(
  "open_notification_settings",
  {
    title: "配置通知",
    description:
      "打开本机飞书通知设置页。用户选择本插件后只需说“配置通知”即可调用；在页面中填写并明确保存后，才会写入私有配置文件。",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
    _meta: { ui: { resourceUri: SETUP_UI_URI } },
  },
  async () => {
    const status = await readSettingsStatus(configPath);
    return {
      content: [{ type: "text", text: settingsDescription(status) }],
      structuredContent: status,
    };
  },
);

server.registerTool(
  "get_notification_settings",
  {
    title: "查看飞书通知设置状态",
    description: "只返回是否已配置和启用，绝不返回 Webhook 或签名密钥。",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async () => {
    const status = await readSettingsStatus(configPath);
    return {
      content: [{ type: "text", text: settingsDescription(status) }],
      structuredContent: status,
    };
  },
);

server.registerTool(
  "save_feishu_settings",
  {
    title: "保存飞书通知设置",
    description:
      "仅在用户通过设置页明确提交后调用。把飞书 Webhook 和可选签名密钥写入当前用户私有配置文件；绝不在结果中返回凭据。",
    inputSchema: {
      webhookUrl: z.string().min(1).max(2000),
      signingSecret: z.string().min(1).max(2000).optional(),
    },
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  async (input) => {
    const status = await saveFeishuSettings(configPath, input);
    hubPromise = hubFromEnvironment();
    return {
      content: [{ type: "text", text: settingsDescription(status) }],
      structuredContent: status,
    };
  },
);

server.registerTool(
  "clear_notification_settings",
  {
    title: "清除飞书通知设置",
    description: "仅在用户明确确认后调用。删除本机私有飞书通知配置并停止外发。",
    inputSchema: {},
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  async () => {
    const status = await clearSettings(configPath);
    hubPromise = hubFromEnvironment();
    return {
      content: [{ type: "text", text: settingsDescription(status) }],
      structuredContent: status,
    };
  },
);

server.registerTool(
  "publish_notification",
  {
    title: "发布关键 Codex 通知",
    description:
      "仅用于需要确认、阻塞、明确完成、不可恢复失败或权限请求。会进行脱敏、去重、限流和可靠发送。",
    inputSchema: {
      type: z.enum(EVENT_TYPES),
      title: z.string().min(1).max(300),
      summary: z.string().min(1).max(2000),
      subject: z.string().max(300).optional(),
      source: z
        .object({
          sessionId: z.string().max(200).optional(),
          turnId: z.string().max(200).optional(),
          project: z.string().max(300).optional(),
        })
        .optional(),
      dedupeKey: z.string().max(300).optional(),
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  async (input) => {
    const result = await (await hubPromise).publish(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
      isError: result.results.every((item) => item.status === "failed"),
    };
  },
);

await server.connect(new StdioServerTransport());

function settingsDescription(status: {
  configured: boolean;
  enabled: boolean;
  hasSigningSecret: boolean;
}): string {
  return status.enabled
    ? `飞书通知已启用（签名校验：${status.hasSigningSecret ? "已配置" : "未配置"}）。`
    : "飞书通知尚未配置，当前不会向外发送消息。";
}
