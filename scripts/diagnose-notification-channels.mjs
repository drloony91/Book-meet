import "dotenv/config";
import { isValidEmail } from "../server/security.js";
import { mailerDiagnostics, sendAccountEmail, verifyMailerConnection } from "../server/modules/mailer.js";
import { telegramLinkConfiguration, verifyTelegramBot } from "../server/modules/notification-channels.js";
import { telegramDiagnostics } from "../server/modules/telegram-outbox.js";

const emailArgument = process.argv.find((argument) => argument.startsWith("--send-test-email="));
const testRecipient = emailArgument ? emailArgument.slice("--send-test-email=".length).trim().toLowerCase() : null;
if (testRecipient && !isValidEmail(testRecipient)) throw new Error("Invalid test recipient");

const [smtpLive, telegramLive] = await Promise.all([
  verifyMailerConnection(),
  verifyTelegramBot(),
]);
const result = {
  smtp: { ...mailerDiagnostics(), liveVerified: smtpLive.verified },
  telegram: { ...telegramDiagnostics(), linkConfigured: telegramLinkConfiguration().configured, apiVerified: telegramLive.verified, webhookConfigured: telegramLive.webhookConfigured },
  testEmail: { requested: Boolean(testRecipient), delivered: false },
};

if (testRecipient) {
  if (!smtpLive.verified) throw new Error("SMTP live verification failed; test message was not sent");
  const sent = await sendAccountEmail({
    to: testRecipient,
    subject: "Book Meet — проверка доставки",
    text: "Это разрешённое тестовое письмо Book Meet. SMTP/TLS и доставка работают.",
    messageId: `book-meet-notification-diagnostic-${Date.now()}`,
  });
  result.testEmail.delivered = sent.delivered === true;
}

console.log(JSON.stringify(result, null, 2));
if (!smtpLive.verified || !telegramLive.verified || testRecipient && !result.testEmail.delivered) process.exitCode = 1;
