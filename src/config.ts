import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { z } from "zod";
import type { HubConfig, SecretRef, SecretValue } from "./types.js";

const secretRef = z.object({ secretRef: z.string().regex(/^env:[A-Z0-9_]+$/) });
const secretValue = z.union([secretRef, z.string().min(1)]);
const configSchema = z.object({
  routing: z.object({
    strategy: z.enum(["all", "first_success"]),
    channels: z.array(
      z.enum(["feishu", "telegram", "wecom", "wechat-experimental"]),
    ),
  }),
  channels: z.object({
    feishu: z
      .object({
        enabled: z.boolean(),
        webhookUrl: secretValue.optional(),
        signingSecret: secretValue.optional(),
      })
      .optional(),
  }),
  queue: z
    .object({
      dedupeWindowSeconds: z.number().int().positive().optional(),
      maxAttempts: z.number().int().min(1).max(10).optional(),
      baseRetryDelayMs: z.number().int().min(0).optional(),
    })
    .optional(),
});

export async function loadConfig(path: string): Promise<HubConfig> {
  try {
    await assertPrivateConfig(path);
    return configSchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    ) as HubConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return defaultConfig();
    throw error;
  }
}

export function defaultConfig(): HubConfig {
  return { routing: { strategy: "all", channels: [] }, channels: {} };
}

export function resolveSecret(reference: SecretValue): string {
  if (typeof reference === "string") return reference;
  const key = reference.secretRef.slice(4);
  const value = process.env[key];
  if (!value) throw new Error(`缺少环境变量 ${key}`);
  return value;
}

export interface FeishuSettings {
  webhookUrl: string;
  signingSecret?: string;
}

export interface SettingsStatus {
  [key: string]: boolean;
  configured: boolean;
  enabled: boolean;
  hasSigningSecret: boolean;
}

export async function readSettingsStatus(
  path: string,
): Promise<SettingsStatus> {
  const config = await loadConfig(path);
  const feishu = config.channels.feishu;
  return {
    configured: Boolean(feishu?.webhookUrl),
    enabled: Boolean(feishu?.enabled && feishu.webhookUrl),
    hasSigningSecret: Boolean(feishu?.signingSecret),
  };
}

export async function saveFeishuSettings(
  path: string,
  settings: FeishuSettings,
): Promise<SettingsStatus> {
  const webhookUrl = validateWebhookUrl(settings.webhookUrl);
  const signingSecret = settings.signingSecret?.trim();
  const config: HubConfig = {
    routing: { strategy: "all", channels: ["feishu"] },
    channels: {
      feishu: {
        enabled: true,
        webhookUrl,
        ...(signingSecret ? { signingSecret } : {}),
      },
    },
  };
  await writePrivateJson(path, config);
  return readSettingsStatus(path);
}

export async function clearSettings(path: string): Promise<SettingsStatus> {
  await rm(path, { force: true });
  return readSettingsStatus(path);
}

function validateWebhookUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith("feishu.cn") ||
    !url.pathname.includes("/open-apis/bot/")
  )
    throw new Error("Webhook 必须是飞书自定义机器人的 HTTPS 地址");
  return url.toString();
}

async function assertPrivateConfig(path: string): Promise<void> {
  const details = await stat(path);
  if ((details.mode & 0o077) !== 0)
    throw new Error("通知配置权限过宽；请通过设置页重新保存");
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
