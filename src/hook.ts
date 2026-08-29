import { hubFromEnvironment } from "./hub.js";
import { eventFromHook } from "./hook-events.js";

async function readStdin(): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const input = await readStdin();
const event = eventFromHook(input);
if (event) {
  try {
    await (await hubFromEnvironment()).publish(event);
  } catch {
    /* hook must not block Codex */
  }
}
process.stdout.write(JSON.stringify({ continue: true }));
