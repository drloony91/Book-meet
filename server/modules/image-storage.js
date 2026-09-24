import { mkdir, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const previewHosts = ["s.f.kz", "simg.marwin.kz", "api.bookmate.ru", "cdn.bookmate.com", "assets.myket.org", "books.yandex.kz", "avatars.mds.yandex.net", "storage.yandexcloud.net", "yastatic.net"];

function cleanUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function hostAllowed(hostname, allowedHosts) {
  const host = hostname.toLowerCase();
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function imageType(content) {
  if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", extension: "png" };
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return { mime: "image/jpeg", extension: "jpg" };
  if (content.length >= 12 && content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP") return { mime: "image/webp", extension: "webp" };
  return null;
}

function decodeDataImage(dataUrl, maximumBytes, label) {
  const match = String(dataUrl ?? "").match(/^data:image\/(png|jpeg|jpg|webp);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw Object.assign(new Error(`Неподдерживаемый формат ${label}`), { statusCode: 400 });
  const content = Buffer.from(match[2], "base64");
  if (!content.length || content.length > maximumBytes) throw Object.assign(new Error(`${label} превышает допустимый размер`), { statusCode: 400 });
  const detected = imageType(content);
  const declared = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  if (!detected || detected.mime !== `image/${declared}`) throw Object.assign(new Error(`Содержимое ${label} не соответствует формату файла`), { statusCode: 400 });
  return { content, extension: detected.extension };
}

async function persistImage(content, extension, prefix = "") {
  const uploadRoot = path.resolve(projectRoot, process.env.UPLOAD_DIR || "uploads");
  await mkdir(uploadRoot, { recursive: true });
  const filename = `${prefix}${Date.now()}-${randomBytes(8).toString("hex")}.${extension}`;
  await writeFile(path.join(uploadRoot, filename), content, { flag: "wx" });
  return `/uploads/${filename}`;
}

async function fetchAllowedImage(input, allowedHosts) {
  let url = cleanUrl(input);
  if (!url || !hostAllowed(url.hostname, allowedHosts)) throw new Error("Недопустимый адрес изображения");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_500);
  try {
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const result = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 BookMeet/1.0" } });
      if ([301, 302, 303, 307, 308].includes(result.status)) {
        const location = result.headers.get("location");
        if (!location || redirect === 3) throw new Error("Слишком много перенаправлений изображения");
        url = new URL(location, url);
        if (!hostAllowed(url.hostname, allowedHosts)) throw new Error("Перенаправление изображения ведет на запрещенный адрес");
        continue;
      }
      if (!result.ok) return null;
      const limit = Number(process.env.MAX_COVER_BYTES || 5 * 1024 * 1024);
      const announcedSize = Number(result.headers.get("content-length") || 0);
      if (announcedSize > limit) throw new Error("Обложка превышает допустимый размер");
      const content = Buffer.from(await result.arrayBuffer());
      if (content.length > limit) throw new Error("Обложка превышает допустимый размер");
      const detected = imageType(content);
      if (!detected) throw new Error("Ответ не является поддерживаемым изображением");
      return { content, ...detected };
    }
  } finally {
    clearTimeout(timeout);
  }
  return null;
}

export async function saveCover(dataUrl) {
  if (!String(dataUrl ?? "").startsWith("data:image/")) return dataUrl || null;
  const image = decodeDataImage(dataUrl, Number(process.env.MAX_COVER_BYTES || 5 * 1024 * 1024), "обложки");
  return persistImage(image.content, image.extension);
}

export async function saveMarketplaceImage(dataUrl) {
  if (typeof dataUrl !== "string" || !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(dataUrl)) {
    throw Object.assign(new Error("Изображение должно быть загружено как файл"), { statusCode: 400, code: "INVALID_LISTING_IMAGE" });
  }
  // Six base64 images must fit under the existing 8 MB JSON request boundary.
  const image = decodeDataImage(dataUrl, 800 * 1024, "изображения объявления");
  const root = path.resolve(projectRoot, process.env.MARKETPLACE_PRIVATE_UPLOAD_DIR || "marketplace-private-uploads");
  await mkdir(root, { recursive: true });
  const filename = `marketplace-${Date.now()}-${randomBytes(8).toString("hex")}.${image.extension}`;
  await writeFile(path.join(root, filename), image.content, { flag: "wx" });
  return `marketplace-private:${filename}`;
}

export function marketplaceImageFile(storageKey) {
  if (typeof storageKey !== "string" || !/^marketplace-private:marketplace-[a-z0-9-]+\.(?:png|jpg|webp)$/.test(storageKey)) return null;
  const root = path.resolve(projectRoot, process.env.MARKETPLACE_PRIVATE_UPLOAD_DIR || "marketplace-private-uploads");
  const target = path.resolve(root, storageKey.slice("marketplace-private:".length));
  return target.startsWith(`${root}${path.sep}`) ? target : null;
}

export async function removeMarketplaceImage(storageKey) {
  const target = marketplaceImageFile(storageKey);
  if (!target) return;
  try { await unlink(target); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

export async function saveAvatar(dataUrl) {
  if (!String(dataUrl ?? "").startsWith("data:image/")) return dataUrl || null;
  const image = decodeDataImage(dataUrl, 600 * 1024, "фотографии профиля");
  return persistImage(image.content, image.extension, "avatar-");
}

export async function saveRemoteCover(coverUrl) {
  if (!coverUrl) return null;
  const image = await fetchAllowedImage(coverUrl, ["s.f.kz"]);
  return image ? persistImage(image.content, image.extension) : null;
}

export async function previewRemoteCover(coverUrl) {
  if (!coverUrl) return "";
  try {
    const image = await fetchAllowedImage(coverUrl, previewHosts);
    return image ? `data:${image.mime};base64,${image.content.toString("base64")}` : "";
  } catch (error) {
    console.warn("Не удалось загрузить обложку для предпросмотра", error?.message ?? error);
    return "";
  }
}
