import nodemailer from "nodemailer";

function mailConfiguration(environment = process.env) {
  const port = Number(environment.SMTP_PORT || 587);
  if (!environment.SMTP_HOST || !environment.SMTP_USER || !environment.SMTP_PASS || !environment.MAIL_FROM || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: environment.SMTP_HOST, port, secure: environment.SMTP_SECURE === "1" || environment.SMTP_SECURE === "true", auth: { user: environment.SMTP_USER, pass: environment.SMTP_PASS }, from: environment.MAIL_FROM };
}

export function mailerEnabled(environment = process.env) {
  return Boolean(mailConfiguration(environment));
}

export async function sendAccountEmail({ to, subject, text }, environment = process.env) {
  const config = mailConfiguration(environment);
  if (!config) return { delivered: false, reason: "disabled" };
  try {
    const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.auth });
    await transport.sendMail({ from: config.from, to, subject, text });
    return { delivered: true };
  } catch {
    // Never log recipients, action links, SMTP credentials or transport errors.
    console.warn("Account email delivery failed; check SMTP configuration.");
    return { delivered: false, reason: "failed" };
  }
}
