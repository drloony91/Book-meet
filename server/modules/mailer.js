import { spawn } from "node:child_process";
import net from "node:net";
import tls from "node:tls";

function mailConfiguration(environment = process.env) {
  const port = Number(environment.SMTP_PORT || 587);
  if (!environment.SMTP_HOST || !environment.SMTP_USER || !environment.SMTP_PASS || !environment.MAIL_FROM || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: environment.SMTP_HOST, port, secure: environment.SMTP_SECURE === "1" || environment.SMTP_SECURE === "true", auth: { user: environment.SMTP_USER, pass: environment.SMTP_PASS }, from: environment.MAIL_FROM };
}

export function mailerEnabled(environment = process.env) {
  return Boolean(mailConfiguration(environment));
}

// This is intentionally structural only. It neither resolves the host nor
// opens a socket, and never returns SMTP credentials or host values.
export function mailerDiagnostics(environment = process.env) {
  const port = Number(environment.SMTP_PORT || 587);
  const requiredFields = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"];
  const missing = requiredFields.filter((field) => !environment[field]);
  const portValid = Number.isInteger(port) && port >= 1 && port <= 65535;
  const configured = missing.length === 0 && portValid;
  const secure = environment.SMTP_SECURE === "1" || environment.SMTP_SECURE === "true";
  const transportMode = secure ? "implicit_tls" : "starttls_required";
  return {
    configured,
    enabled: mailerEnabled(environment),
    status: configured ? "configured_unverified" : "not_configured",
    missing: missing.map((field) => field.toLowerCase()),
    portValid,
    secure,
    transportMode,
  };
}

function mimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function safeMessageId(value) {
  const token = String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 160);
  return token ? `<${token}@bookmeet.club>` : undefined;
}

function sendWithLocalMta({ to, subject, text, messageId }, config, environment) {
  const sendmailPath = environment.SENDMAIL_PATH || "/usr/sbin/sendmail";
  const message = [
    `From: ${config.from}`,
    `To: ${to}`,
    `Subject: ${mimeHeader(subject)}`,
    ...(safeMessageId(messageId) ? [`Message-ID: ${safeMessageId(messageId)}`] : []),
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

function smtpAddress(value) {
  const address = value.match(/<([^>]+)>/)?.[1] || value;
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(address)) throw new Error("Invalid SMTP address");
  return address;
}

function connectSmtp(config) {
  return new Promise((resolve, reject) => {
    const isLocal = config.host === "localhost" || config.host === "127.0.0.1";
    const timeout = setTimeout(() => reject(new Error("SMTP connection timed out")), 10_000);
    const ready = (socket) => { clearTimeout(timeout); resolve(socket); };
    const failed = (error) => { clearTimeout(timeout); reject(error); };
    const socket = config.secure
      ? tls.connect({ host: config.host, port: config.port, servername: config.host, rejectUnauthorized: !isLocal }, () => ready(socket))
      : net.createConnection({ host: config.host, port: config.port }, () => ready(socket));
    socket.once("error", failed);
  });
}

function smtpReplies(socket) {
  let buffer = "";
  const replies = [];
  const waiters = [];
  let error;
  const flush = () => {
    while (replies.length && waiters.length) waiters.shift().resolve(replies.shift());
    if (error) while (waiters.length) waiters.shift().reject(error);
  };
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\r\n");
    buffer = lines.pop() || "";
    for (const line of lines) if (/^\d{3} /.test(line)) replies.push({ code: Number(line.slice(0, 3)), line });
    flush();
  });
  socket.once("error", (value) => { error = value; flush(); });
  socket.once("close", () => { if (!error) { error = new Error("SMTP connection closed"); flush(); } });
  return () => new Promise((resolve, reject) => {
    if (replies.length) return resolve(replies.shift());
    if (error) return reject(error);
    waiters.push({ resolve, reject });
  });
}

async function smtpCommand(socket, next, command, accepted = [250]) {
  socket.write(`${command}\r\n`, "utf8");
  const reply = await next();
  if (!accepted.includes(reply.code)) throw new Error(`SMTP command failed: ${reply.code}`);
  return reply;
}

async function sendWithSocketSmtp({ to, subject, text, messageId }, config) {
  const isLocal = config.host === "localhost" || config.host === "127.0.0.1";
  let socket = await connectSmtp(config);
  let next = smtpReplies(socket);
  if ((await next()).code !== 220) throw new Error("SMTP greeting failed");
  let hello = await smtpCommand(socket, next, "EHLO bookmeet.club");
  if (!config.secure && /STARTTLS/i.test(hello.line)) {
    await smtpCommand(socket, next, "STARTTLS", [220]);
    socket = tls.connect({ socket, servername: config.host, rejectUnauthorized: !isLocal });
    next = smtpReplies(socket);
    await new Promise((resolve, reject) => { socket.once("secureConnect", resolve); socket.once("error", reject); });
    hello = await smtpCommand(socket, next, "EHLO bookmeet.club");
  } else if (!config.secure && !isLocal) {
    throw new Error("SMTP server does not support STARTTLS");
  }
  if (/AUTH(?:=|\s)/i.test(hello.line)) {
    const auth = Buffer.from(`\u0000${config.auth.user}\u0000${config.auth.pass}`, "utf8").toString("base64");
    await smtpCommand(socket, next, `AUTH PLAIN ${auth}`, [235]);
  } else if (!isLocal) {
    throw new Error("SMTP authentication unavailable");
  }
  const sender = smtpAddress(config.from);
  const recipient = smtpAddress(to);
  await smtpCommand(socket, next, `MAIL FROM:<${sender}>`);
  await smtpCommand(socket, next, `RCPT TO:<${recipient}>`);
  await smtpCommand(socket, next, "DATA", [354]);
  const body = Buffer.from(text, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
  socket.write([`From: ${config.from}`, `To: ${recipient}`, `Subject: ${mimeHeader(subject)}`, ...(safeMessageId(messageId) ? [`Message-ID: ${safeMessageId(messageId)}`] : []), "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body, ".", ""].join("\r\n"), "utf8");
  if ((await next()).code !== 250) throw new Error("SMTP message rejected");
  try { await smtpCommand(socket, next, "QUIT", [221]); } finally { socket.end(); }
}

export async function verifyMailerConnection(environment = process.env) {
  const config = mailConfiguration(environment);
  if (!config) return { configured: false, verified: false, secure: false };
  try {
    const { default: nodemailer } = await import("nodemailer");
    const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.auth, requireTLS: !config.secure });
    await transport.verify();
    transport.close();
    return { configured: true, verified: true, secure: config.secure };
  } catch {
    return { configured: true, verified: false, secure: config.secure };
  }
}

export async function sendAccountEmail({ to, subject, text, messageId }, environment = process.env) {
  const config = mailConfiguration(environment);
  if (!config) return { delivered: false, reason: "disabled" };
  try {
    const { default: nodemailer } = await import("nodemailer");
    const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.auth, requireTLS: !config.secure });
    await transport.sendMail({ from: config.from, to, subject, text, messageId: safeMessageId(messageId) });
    return { delivered: true };
  } catch {
    try {
      await sendWithSocketSmtp({ to, subject, text, messageId }, config);
      return { delivered: true, transport: "smtp_socket" };
    } catch {
      try {
        await sendWithLocalMta({ to, subject, text, messageId }, config, environment);
        return { delivered: true, transport: "local_mta" };
      } catch {
        // Never log recipients, action links, SMTP credentials or transport errors.
        console.warn("Account email delivery failed; check SMTP or local MTA configuration.");
        return { delivered: false, reason: "failed" };
      }
    }
  }
}
