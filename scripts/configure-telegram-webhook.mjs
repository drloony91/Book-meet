import "dotenv/config";
import { configureTelegramWebhook, verifyTelegramBot } from "../server/modules/notification-channels.js";

if (!process.argv.includes("--apply")) {
  console.error("Refusing to change Telegram webhook without --apply");
  process.exit(2);
}

const applied = await configureTelegramWebhook();
const live = applied.applied ? await verifyTelegramBot() : { configured: applied.configured, verified: false, webhookConfigured: false };
const result = {
  configured: applied.configured,
  applied: applied.applied,
  botVerified: live.verified,
  webhookConfigured: live.webhookConfigured,
};
console.log(JSON.stringify(result, null, 2));
if (!result.applied || !result.botVerified || !result.webhookConfigured) process.exitCode = 1;
