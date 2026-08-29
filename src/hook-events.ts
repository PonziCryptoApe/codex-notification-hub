import type { NotificationEvent } from "./types.js";

export function eventFromHook(
  input: Record<string, unknown>,
): NotificationEvent | undefined {
  const source = {
    sessionId: asText(input.session_id),
    turnId: asText(input.turn_id),
    project: asText(input.cwd),
  };
  if (input.hook_event_name === "PermissionRequest")
    return {
      type: "PermissionRequired",
      title: "Codex 需要权限",
      summary: `即将请求 ${asText(input.tool_name) || "工具"} 权限；请在 Codex 中审阅动作范围。`,
      subject: `permission:${source.sessionId}:${source.turnId}`,
      source,
    };
  if (input.hook_event_name !== "Stop" || input.stop_hook_active)
    return undefined;
  const message = asText(input.last_assistant_message);
  if (/需要.{0,10}(确认|选择)|need.{0,10}(confirm|approval)/i.test(message))
    return {
      type: "NeedsConfirmation",
      title: "Codex 等待确认",
      summary: "任务停止时检测到尚待确认的下一步；请返回 Codex 查看详情。",
      subject: `stop-confirm:${source.sessionId}:${source.turnId}`,
      source,
    };
  if (/(执行失败|无法继续|failed|blocked)/i.test(message))
    return {
      type: "ExecutionFailed",
      title: "Codex 执行未完成",
      summary:
        "任务停止时检测到不可继续的表述；请返回 Codex 查看经过与下一步。",
      subject: `stop-failed:${source.sessionId}:${source.turnId}`,
      source,
    };
  return undefined;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 500) : "";
}
