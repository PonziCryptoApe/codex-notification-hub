import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type {
  ChannelAdapter,
  SanitizedNotification,
  SendResult,
} from "./types.js";

interface StoredItem {
  id: string;
  channel: string;
  event: SanitizedNotification;
  createdAt: number;
  attempts: number;
}
interface QueueOptions {
  dataDir: string;
  dedupeWindowMs: number;
  maxAttempts: number;
  baseRetryDelayMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class NotificationQueue {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly lastSent = new Map<string, number>();
  constructor(private readonly options: QueueOptions) {
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }
  private get queueDir() {
    return join(this.options.dataDir, "queue");
  }
  private get dedupePath() {
    return join(this.options.dataDir, "dedupe.json");
  }

  async enqueue(
    channel: string,
    event: SanitizedNotification,
  ): Promise<{ id: string; deduped: boolean }> {
    await mkdir(this.queueDir, { recursive: true, mode: 0o700 });
    await chmod(this.queueDir, 0o700);
    const dedupe = await this.readDedupe();
    const now = this.now();
    for (const [key, at] of Object.entries(dedupe))
      if (now - at > this.options.dedupeWindowMs) delete dedupe[key];
    const key = `${channel}:${event.dedupeKey}`;
    if (dedupe[key]) return { id: event.dedupeKey, deduped: true };
    dedupe[key] = now;
    await this.atomicJson(this.dedupePath, dedupe);
    const id = createHash("sha256").update(`${key}:${now}`).digest("hex");
    await this.atomicJson(join(this.queueDir, `${id}.json`), {
      id,
      channel,
      event,
      createdAt: now,
      attempts: 0,
    } satisfies StoredItem);
    return { id, deduped: false };
  }

  async deliver(id: string, adapter: ChannelAdapter): Promise<SendResult> {
    const path = join(this.queueDir, `${id}.json`);
    let item: StoredItem;
    try {
      item = JSON.parse(await readFile(path, "utf8")) as StoredItem;
    } catch {
      return {
        channel: adapter.kind,
        status: "skipped",
        retryable: false,
        attempt: 0,
        errorCode: "missing_queue_item",
      };
    }
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      const last = this.lastSent.get(item.channel) ?? 0;
      const wait = Math.max(0, 1000 - (this.now() - last));
      if (wait) await this.sleep(wait);
      const result = await adapter.send(item.event);
      result.attempt = attempt;
      this.lastSent.set(item.channel, this.now());
      if (
        result.status === "sent" ||
        !result.retryable ||
        attempt === this.options.maxAttempts
      ) {
        await rm(path, { force: true });
        return result;
      }
      item.attempts = attempt;
      await this.atomicJson(path, item);
      await this.sleep(this.options.baseRetryDelayMs * 2 ** (attempt - 1));
    }
    return {
      channel: adapter.kind,
      status: "failed",
      retryable: false,
      attempt: this.options.maxAttempts,
    };
  }

  private async readDedupe(): Promise<Record<string, number>> {
    try {
      return JSON.parse(await readFile(this.dedupePath, "utf8")) as Record<
        string,
        number
      >;
    } catch {
      return {};
    }
  }
  private async atomicJson(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  }
}
