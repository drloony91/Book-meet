import { spawn } from "node:child_process";

function mailConfiguration(environment = process.env) {
  const port = Number(environment.SMTP_PORT || 587);
  if (!environment.SMTP_HOST || !environment.SMTP_USER || !environment.SMTP_PASS || !environment.MAIL_FROM || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: environment.SMTP_HOST, port, secure: environment.SMTP_SECURE === "1" || environment.SMTP_SECURE === "true", auth: { user: environment.SMTP_USER, pass: environment.SMTP_PASS }, from: environment.MAIL_FROM };
}

export function mailerEnabled(environment = process.env) {
  return Boolean(mailConfiguration(environment));
}

function mimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function sendWithLocalMta({ to, subject, text }, config, environment) {
  const sendmailPath = environment.SENDMAIL_PATH || "/usr/sbin/sendmail";
  const message = [
    `From: ${config.from}`,
    `To: ${to}`,
    `Subject: ${mimeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
  ].join("\r\n");

  return new Promise((resolve, reject) => {
    const process = spawn(sendmailPath, ["-i", "-f", config.from.match(/<([^>]+)>/)?.[1] || config.from, to], { stdio: ["pipe", "ignore", "ignore"] });
    process.once("error", reject);
    process.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Local mail transport failed")));
    process.stdin.end(message, "utf8");
  });
}

export async function sendAccountEmail({ to, subject, text }, environment = process.env) {
  const config = mailConfiguration(environment);
  if (!config) return { delivered: false, reason: "disabled" };
  try {
    const { default: nodemailer } = await import("nodemailer");
    const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.auth });
    await transport.sendMail({ from: config.from, to, subject, text });
    return { delivered: true };
  } catch {
    try {
      await sendWithLocalMta({ to, subject, text }, config, environment);
      return { delivered: true, transport: "local_mta" };
    } catch {
      // Never log recipients, action links, SMTP credentials or transport errors.
      console.warn("Account email delivery failed; check SMTP or local MTA configuration.");
      return { delivered: false, reason: "failed" };
    }
  }
}
