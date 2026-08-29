import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const failures = [];
const requiredFiles = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "hooks/hooks.json",
  "skills/notification-policy/SKILL.md",
  "dist/server.js",
  "dist/hook.js",
  ".agents/plugins/marketplace.json",
];

for (const path of requiredFiles) {
  try {
    await access(path, constants.R_OK);
  } catch {
    failures.push(`缺少发布文件：${path}`);
  }
}

let manifest;
try {
  manifest = JSON.parse(await readFile(".codex-plugin/plugin.json", "utf8"));
} catch {
  failures.push("plugin.json 不是有效 JSON");
}

if (manifest) {
  if (manifest.name !== "codex-notification-hub")
    failures.push("plugin.json 的 name 必须为 codex-notification-hub");
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(manifest.version ?? ""))
    failures.push("plugin.json 的 version 必须为语义版本");
  if (manifest.mcpServers !== "./.mcp.json")
    failures.push("plugin.json 必须引用 ./.mcp.json");
}

let marketplace;
try {
  marketplace = JSON.parse(
    await readFile(".agents/plugins/marketplace.json", "utf8"),
  );
} catch {
  failures.push("marketplace.json 不是有效 JSON");
}

const marketplaceEntry = marketplace?.plugins?.find(
  (entry) => entry.name === "codex-notification-hub",
);
if (
  marketplaceEntry?.source?.source !== "url" ||
  marketplaceEntry.source.url !==
    "https://github.com/PonziCryptoApe/codex-notification-hub.git" ||
  marketplaceEntry.source.ref !== `v${manifest?.version ?? ""}`
)
  failures.push("marketplace 必须指向当前版本的 GitHub 插件来源");

const example = await readFile("config.example.json", "utf8");
if (
  /FEISHU_WEBHOOK_URL\"\s*:\s*\"https?:\/\/(?![^\"]*replace-me)/.test(example)
)
  failures.push("示例配置不能包含真实飞书 Webhook");
if (example.includes('FEISHU_WEBHOOK_SECRET": "sk-'))
  failures.push("示例配置不能包含真实秘密");

const skill = await readFile("skills/notification-policy/SKILL.md", "utf8");
if (
  !skill.startsWith("---\nname: notification-policy\n") ||
  skill.includes("[TODO:")
)
  failures.push("通知技能缺少有效 frontmatter 或仍有 TODO");

if (failures.length) {
  console.error(`发布校验失败：\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("发布校验通过。");
