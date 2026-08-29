import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { loadConfig, resolveSecret } from "./config.js";
import { FeishuAdapter } from "./feishu.js";
import { NotificationQueue } from "./queue.js";
import { toSafeEvent } from "./sanitize.js";
import type {
  ChannelAdapter,
  HubConfig,
  NotificationEvent,
  SendResult,
} from "./types.js";

export class NotificationHub {
  constructor(
    private readonly config: HubConfig,
    private readonly queue: NotificationQueue,
    private readonly adapters: Map<string, ChannelAdapter>,
  ) {}

  static async fromFiles(
    configPath: string,
    dataDir: string,
  ): Promise<NotificationHub> {
    const config = await loadConfig(configPath);
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await chmod(dataDir, 0o700);
    const adapters = new Map<string, ChannelAdapter>();
    const feishu = config.channels.feishu;
    if (feishu?.enabled) {
      if (!feishu.webhookUrl)
        throw new Error(
          "飞书已启用，但 config.json 缺少 webhookUrl 的环境变量引用",
        );
      adapters.set(
        "feishu",
        new FeishuAdapter({
          webhookUrl: resolveSecret(feishu.webhookUrl),
          signingSecret: feishu.signingSecret
            ? resolveSecret(feishu.signingSecret)
            : undefined,
        }),
      );
    }
    const queue = new NotificationQueue({
      dataDir,
      dedupeWindowMs: (config.queue?.dedupeWindowSeconds ?? 86_400) * 1000,
      maxAttempts: config.queue?.maxAttempts ?? 4,
      baseRetryDelayMs: config.queue?.baseRetryDelayMs ?? 1000,
    });
    return new NotificationHub(config, queue, adapters);
  }

  async publish(
    input: NotificationEvent,
  ): Promise<{ dedupeKey: string; results: SendResult[] }> {
    const event = toSafeEvent(input);
    const results: SendResult[] = [];
    for (const channel of this.config.routing.channels) {
      const adapter = this.adapters.get(channel);
      if (!adapter) {
        results.push({
          channel,
          status: "skipped",
          retryable: false,
          attempt: 0,
          errorCode: "channel_not_implemented_or_disabled",
        });
        continue;
      }
      const queued = await this.queue.enqueue(channel, event);
      if (queued.deduped) {
        results.push({
          channel,
          status: "deduped",
          retryable: false,
          attempt: 0,
        });
        continue;
      }
      const result = await this.queue.deliver(queued.id, adapter);
      results.push(result);
      if (
        this.config.routing.strategy === "first_success" &&
        result.status === "sent"
      )
        break;
    }
    return { dedupeKey: event.dedupeKey, results };
  }
}

export async function hubFromEnvironment(): Promise<NotificationHub> {
  const configPath = process.env.CODEX_NOTIFICATION_HUB_CONFIG;
  const dataDir = process.env.CODEX_NOTIFICATION_HUB_DATA_DIR;
  if (!configPath || !dataDir)
    throw new Error(
      "需要 CODEX_NOTIFICATION_HUB_CONFIG 和 CODEX_NOTIFICATION_HUB_DATA_DIR",
    );
  return NotificationHub.fromFiles(configPath, dataDir);
}
