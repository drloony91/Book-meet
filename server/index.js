import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { apiRateLimit } from "./modules/request-limits.js";

const app = express();
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uploadRoot = path.resolve(projectRoot, process.env.UPLOAD_DIR || "uploads");
const production = process.env.NODE_ENV === "production";
const demoMode = process.env.DEMO_MODE === "1";

function configuredOrigin(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

async function start() {
  if (production && demoMode) {
    throw new Error("DEMO_MODE запрещён в production");
  }

  const { default: api } = await import(demoMode ? "./demo-api.js" : "./api.js");

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  const canonicalOrigin = configuredOrigin(process.env.APP_ORIGIN);
  const legacyOrigin = configuredOrigin(process.env.LEGACY_ORIGIN);
  if (canonicalOrigin && legacyOrigin && canonicalOrigin !== legacyOrigin) {
    const legacyHostname = new URL(legacyOrigin).hostname.toLowerCase();
    app.use((request, response, next) => {
      if (request.hostname.toLowerCase() !== legacyHostname) return next();
      const requestPath = request.originalUrl.startsWith("/") ? request.originalUrl : `/${request.originalUrl}`;
      return response.redirect(301, `${canonicalOrigin}${requestPath}`);
    });
  }
  app.use(express.json({ limit: "8mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (production) response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });

  await mkdir(uploadRoot, { recursive: true });
  app.use("/uploads", express.static(uploadRoot, { dotfiles: "deny", fallthrough: false, maxAge: production ? "7d" : 0 }));
  app.use("/api", (request, response, next) => {
    const origin = request.headers.origin;
    const allowedOrigin = process.env.APP_ORIGIN;
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && origin && allowedOrigin && origin !== new URL(allowedOrigin).origin) {
      return response.status(403).json({ error: "Запрос с другого сайта отклонён" });
    }
    next();
  });
  app.use("/api", apiRateLimit);
  app.use("/book-meet-return", (request, response, next) => {
    request.url = "/auth/google/callback";
    api(request, response, next);
  });
  app.use("/api", api);

  if (production || demoMode) {
    const clientRoot = path.join(projectRoot, "dist", "client");
    app.use(express.static(clientRoot, { index: false, maxAge: production ? "1h" : 0 }));
    app.get("*", (_request, response) => response.sendFile(path.join(clientRoot, "index.html")));
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({ root: projectRoot, server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  }

  app.use((error, _request, response, _next) => {
    console.error(error);
    const status = error.statusCode || 500;
    const message = process.env.NODE_ENV === "production" && status >= 500 ? "Не удалось выполнить запрос" : error.message;
    response.status(status).json({ error: message });
  });

  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, () => {
    console.log(`Book Meet запущен на http://localhost:${port}`);
  });

  function shutdown(signal) {
    console.log(`${signal}: останавливаем Book Meet`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
