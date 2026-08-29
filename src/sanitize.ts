import { createHash } from "node:crypto";
import type { NotificationEvent, SanitizedNotification } from "./types.js";

const MAX_TEXT = 500;
const sensitivePatterns = [
  /(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi,
  /https?:\/\/[^\s?]+\?[^\s]+/gi,
  /(?:sk|xoxb|ghp)_[A-Za-z0-9_-]+/g,
];

export function redact(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  const redacted = sensitivePatterns.reduce(
    (value, pattern) => value.replace(pattern, "[已脱敏]"),
    singleLine,
  );
  return redacted.length > MAX_TEXT
    ? `${redacted.slice(0, MAX_TEXT - 1)}…`
    : redacted;
}

export function toSafeEvent(input: NotificationEvent): SanitizedNotification {
  const title = redact(input.title);
  const summary = redact(input.summary);
  const subject = redact(input.subject ?? title);
  const source = {
    sessionId: redact(input.source?.sessionId ?? "unknown"),
    turnId: redact(input.source?.turnId ?? "unknown"),
    project: redact(input.source?.project ?? "unknown"),
  };
  const canonical = JSON.stringify({
    type: input.type,
    subject,
    source,
    summary,
  });
  const dedupeKey = input.dedupeKey
    ? redact(input.dedupeKey)
    : `v1:${input.type}:${createHash("sha256").update(canonical).digest("hex")}`;
  return {
    type: input.type,
    title,
    summary,
    subject,
    source,
    dedupeKey,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
}
