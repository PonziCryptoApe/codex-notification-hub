import { createHmac } from "node:crypto";
import type {
  ChannelAdapter,
  SanitizedNotification,
  SendResult,
} from "./types.js";

export interface FeishuOptions {
  webhookUrl: string;
  signingSecret?: string;
  fetchImpl?: typeof fetch;
}

export function feishuSignature(timestamp: string, secret: string): string {
  return createHmac("sha256", `${timestamp}\n${secret}`)
    .update("")
    .digest("base64");
}

export class FeishuAdapter implements ChannelAdapter {
  readonly kind = "feishu" as const;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: FeishuOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(event: SanitizedNotification): Promise<SendResult> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body: Record<string, unknown> = {
      msg_type: "interactive",
      card: {
        config: { wide_screen_mode: true },
        header: {
          title: { tag: "plain_text", content: event.title },
          template: colorFor(event.type),
        },
        elements: [
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: `**${event.type}**\n${event.summary}`,
            },
          },
        ],
      },
    };
    if (this.options.signingSecret)
      Object.assign(body, {
        timestamp,
        sign: feishuSignature(timestamp, this.options.signingSecret),
      });
    try {
      const response = await this.fetchImpl(this.options.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        code?: number;
        StatusCode?: number;
      };
      const ok =
        response.ok &&
        (payload.code === undefined || payload.code === 0) &&
        (payload.StatusCode === undefined || payload.StatusCode === 0);
      return ok
        ? { channel: this.kind, status: "sent", retryable: false, attempt: 1 }
        : {
            channel: this.kind,
            status: "failed",
            retryable:
              response.status === 408 ||
              response.status === 429 ||
              response.status >= 500,
            attempt: 1,
            errorCode: `http_${response.status}`,
          };
    } catch {
      return {
        channel: this.kind,
        status: "failed",
        retryable: true,
        attempt: 1,
        errorCode: "network_error",
      };
    }
  }
}

function colorFor(type: SanitizedNotification["type"]): string {
  return type === "GoalCompleted"
    ? "green"
    : type === "PermissionRequired" || type === "NeedsConfirmation"
      ? "orange"
      : "red";
}
