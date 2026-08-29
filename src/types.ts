export const EVENT_TYPES = [
  "NeedsConfirmation",
  "Blocked",
  "GoalCompleted",
  "ExecutionFailed",
  "PermissionRequired",
] as const;

export type NotificationEventType = (typeof EVENT_TYPES)[number];
export type RouteStrategy = "all" | "first_success";
export type ChannelKind =
  "feishu" | "telegram" | "wecom" | "wechat-experimental";

export interface NotificationEvent {
  type: NotificationEventType;
  title: string;
  summary: string;
  subject?: string;
  source?: { sessionId?: string; turnId?: string; project?: string };
  dedupeKey?: string;
  occurredAt?: string;
}

export interface SendResult {
  channel: ChannelKind;
  status: "sent" | "failed" | "skipped" | "deduped";
  retryable: boolean;
  attempt: number;
  messageId?: string;
  errorCode?: string;
}

export interface ChannelAdapter {
  readonly kind: ChannelKind;
  send(event: SanitizedNotification): Promise<SendResult>;
}

export interface SanitizedNotification extends Required<
  Pick<NotificationEvent, "type" | "title" | "summary">
> {
  subject: string;
  source: Required<NonNullable<NotificationEvent["source"]>>;
  dedupeKey: string;
  occurredAt: string;
}

export interface HubConfig {
  routing: { strategy: RouteStrategy; channels: ChannelKind[] };
  channels: {
    feishu?: {
      enabled: boolean;
      webhookUrl?: SecretValue;
      signingSecret?: SecretValue;
    };
  };
  queue?: {
    dedupeWindowSeconds?: number;
    maxAttempts?: number;
    baseRetryDelayMs?: number;
  };
}

export interface SecretRef {
  secretRef: `env:${string}`;
}

/** A secret can be injected by the host or stored in the private plugin data file. */
export type SecretValue = SecretRef | string;
