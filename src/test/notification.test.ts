import assert from "node:assert/strict";
import { chmod, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FeishuAdapter, feishuSignature } from "../feishu.js";
import {
  loadConfig,
  readSettingsStatus,
  saveFeishuSettings,
} from "../config.js";
import { eventFromHook } from "../hook-events.js";
import { NotificationHub } from "../hub.js";
import { NotificationQueue } from "../queue.js";
import { toSafeEvent } from "../sanitize.js";
import type {
  ChannelAdapter,
  HubConfig,
  SanitizedNotification,
  SendResult,
} from "../types.js";

const event = () => ({
  type: "GoalCompleted" as const,
  title: "任务完成",
  summary: "已通过验证 token=secret-value https://example.test/?secret=x",
  subject: "task-1",
});

test("脱敏与确定性去重键", () => {
  const first = toSafeEvent(event());
  const second = toSafeEvent(event());
  assert.equal(first.dedupeKey, second.dedupeKey);
  assert.match(first.summary, /\[已脱敏\]/);
  assert.doesNotMatch(first.summary, /secret-value|\?secret/);
});

test("没有本机配置时安全地保持所有通道关闭", async () => {
  const dir = await mkdtemp(join(tmpdir(), "notification-hub-"));
  const config = await loadConfig(join(dir, "config.json"));
  assert.deepEqual(config.routing.channels, []);
  assert.equal(config.channels.feishu, undefined);
});

test("设置页保存的飞书凭据仅存在于私有配置文件", async () => {
  const dir = await mkdtemp(join(tmpdir(), "notification-hub-"));
  const path = join(dir, "config.json");
  const status = await saveFeishuSettings(path, {
    webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/example-token",
    signingSecret: "signing-secret",
  });
  assert.deepEqual(status, {
    configured: true,
    enabled: true,
    hasSigningSecret: true,
  });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const saved = await loadConfig(path);
  assert.equal(typeof saved.channels.feishu?.webhookUrl, "string");
  assert.equal((await readSettingsStatus(path)).enabled, true);
  await chmod(path, 0o644);
  await assert.rejects(loadConfig(path), /权限过宽/);
});

test("飞书签名与卡片契约", async () => {
  assert.equal(
    feishuSignature("1700000000", "abc"),
    "VIS10b0EBvzzSdFnuk4tznEmK5wHaruvf/WnViv2yR4=",
  );
  let body = "";
  const fakeService: typeof fetch = async (_, init) => {
    body = String(init?.body);
    return new Response('{"code":0}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const result = await new FeishuAdapter({
    webhookUrl: "http://fake-feishu.invalid",
    signingSecret: "abc",
    fetchImpl: fakeService,
  }).send(toSafeEvent(event()));
  assert.equal(result.status, "sent");
  assert.equal(JSON.parse(body).msg_type, "interactive");
});

class FakeAdapter implements ChannelAdapter {
  readonly kind = "feishu" as const;
  calls = 0;
  constructor(private readonly failures = 0) {}
  async send(_: SanitizedNotification): Promise<SendResult> {
    this.calls += 1;
    return this.calls <= this.failures
      ? { channel: this.kind, status: "failed", retryable: true, attempt: 1 }
      : { channel: this.kind, status: "sent", retryable: false, attempt: 1 };
  }
}
function config(strategy: "all" | "first_success"): HubConfig {
  return {
    routing: { strategy, channels: ["feishu", "telegram"] },
    channels: {
      feishu: {
        enabled: true,
        webhookUrl: { secretRef: "env:FEISHU_WEBHOOK_URL" },
      },
    },
    queue: { baseRetryDelayMs: 0, maxAttempts: 3 },
  };
}

test("队列重试、去重和 first_success", async () => {
  const dir = await mkdtemp(join(tmpdir(), "notification-hub-"));
  const adapter = new FakeAdapter(1);
  const queue = new NotificationQueue({
    dataDir: dir,
    dedupeWindowMs: 60_000,
    maxAttempts: 3,
    baseRetryDelayMs: 0,
    sleep: async () => {},
  });
  const hub = new NotificationHub(
    config("first_success"),
    queue,
    new Map([["feishu", adapter]]),
  );
  const first = await hub.publish(event());
  assert.equal(first.results[0]?.status, "sent");
  assert.equal(adapter.calls, 2);
  assert.equal(first.results.length, 1);
  const second = await hub.publish(event());
  assert.equal(second.results[0]?.status, "deduped");
});

test("all 策略会报告未实现扩展点", async () => {
  const dir = await mkdtemp(join(tmpdir(), "notification-hub-"));
  const adapter = new FakeAdapter();
  const hub = new NotificationHub(
    config("all"),
    new NotificationQueue({
      dataDir: dir,
      dedupeWindowMs: 60_000,
      maxAttempts: 1,
      baseRetryDelayMs: 0,
    }),
    new Map([["feishu", adapter]]),
  );
  const outcome = await hub.publish(event());
  assert.equal(outcome.results.length, 2);
  assert.equal(outcome.results[1]?.status, "skipped");
});

test("钩子仅捕获权限与保守的 Stop 兜底", () => {
  assert.equal(
    eventFromHook({
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      session_id: "s",
      turn_id: "t",
      cwd: "/safe",
    })?.type,
    "PermissionRequired",
  );
  assert.equal(
    eventFromHook({
      hook_event_name: "Stop",
      last_assistant_message: "下一步需要用户确认",
      session_id: "s",
      turn_id: "t",
      cwd: "/safe",
    })?.type,
    "NeedsConfirmation",
  );
  assert.equal(
    eventFromHook({
      hook_event_name: "Stop",
      last_assistant_message: "普通进度更新",
    }),
    undefined,
  );
});
