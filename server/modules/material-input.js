import { normalizeIdentity } from "../security.js";

export const CYRILLIC_CITY_PATTERN = /^[А-ЯЁа-яёІіҢңҒғҮүҰұҚқӨөҺһӘәЎўЇїЄєҐґЏџЉљЊњЋћЌќ\s.'’()-]+$/u;

export function cleanUrl(value) {
  if (!value) return "";
  const url = new URL(String(value));
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Разрешены только HTTP/HTTPS ссылки");
  return url.toString();
}

export function eventPayload(body = {}) {
  const linkedBookId = body.relatedToBook || body.linkedBookId ? Number(body.linkedBookId) || undefined : undefined;
  const payload = {
    title: String(body.title ?? "").trim().slice(0, 200),
    summary: String(body.summary ?? "").trim().slice(0, 1200),
    description: String(body.description ?? "").trim(),
    isAdult: Boolean(body.isAdult),
    date: String(body.date ?? "").trim(),
    time: String(body.time ?? "").trim(),
    city: String(body.city ?? "").trim().slice(0, 120),
    address: String(body.address ?? "").trim().slice(0, 255),
    mapUrl: cleanUrl(body.mapUrl),
    detailsUrl: cleanUrl(body.detailsUrl),
    linkedBookId,
  };
  if (!payload.title || !payload.summary || !payload.description || !payload.date || !payload.time || !payload.city || !payload.address) {
    throw Object.assign(new Error("Заполните название, краткое и полное описание, дату, время, город и адрес"), { statusCode: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date) || !/^\d{2}:\d{2}$/.test(payload.time)) {
    throw Object.assign(new Error("Проверьте дату и время события"), { statusCode: 400 });
  }
  if (!CYRILLIC_CITY_PATTERN.test(payload.city)) throw Object.assign(new Error("Выберите город из списка на кириллице"), { statusCode: 400 });
  return payload;
}

const OCCASION_TYPES = new Set(["meet", "discuss", "invite"]);
const TARGET_GENDERS = new Set(["Мужской", "Женский", "Все"]);
const TARGET_PROFILE_TYPES = new Set(["Писатель", "Читатель", "Блогер", "Все"]);

export function occasionPayload(body = {}) {
  const type = String(body.type ?? "");
  const primaryText = String(body.primaryText ?? "").trim().slice(0, 5000);
  const audienceText = String(body.audienceText ?? "").trim().slice(0, 3000);
  const targetGender = String(body.targetGender ?? "Все");
  const targetProfileType = String(body.targetProfileType ?? "Все");
  const targetCities = Array.from(new Set((Array.isArray(body.targetCities) ? body.targetCities : []).map((city) => String(city).trim()).filter(Boolean))).slice(0, 30);
  const meetingDate = type === "invite" ? String(body.meetingDate ?? "").trim() : "";
  const meetingStartTime = type === "invite" ? String(body.meetingStartTime ?? "").trim() : "";
  const meetingEndTime = type === "invite" ? String(body.meetingEndTime ?? "").trim() : "";
  if (!OCCASION_TYPES.has(type) || !primaryText || !audienceText || !TARGET_GENDERS.has(targetGender) || !TARGET_PROFILE_TYPES.has(targetProfileType) || !targetCities.length) {
    throw Object.assign(new Error("Заполните все поля повода для знакомства"), { statusCode: 400 });
  }
  if (targetCities.some((city) => !CYRILLIC_CITY_PATTERN.test(city))) throw Object.assign(new Error("Выберите города из списка на кириллице"), { statusCode: 400 });
  if (type === "invite") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate) || meetingDate <= new Date().toISOString().slice(0, 10)) {
      throw Object.assign(new Error("Выберите будущую дату встречи"), { statusCode: 400 });
    }
    if (meetingEndTime && !meetingStartTime) {
      throw Object.assign(new Error("Время завершения можно указать только после времени начала"), { statusCode: 400 });
    }
    if (meetingStartTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(meetingStartTime) || meetingEndTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(meetingEndTime)) {
      throw Object.assign(new Error("Проверьте время встречи"), { statusCode: 400 });
    }
  }
  return { type, primaryText, audienceText, isAdult: Boolean(body.isAdult), targetGender, targetCities, targetProfileType, meetingDate: meetingDate || undefined, meetingStartTime: meetingStartTime || undefined, meetingEndTime: meetingEndTime || undefined };
}

export async function knownCity(connection, name, preferredId) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName || !CYRILLIC_CITY_PATTERN.test(cleanName)) throw Object.assign(new Error("Выберите город из списка на кириллице"), { statusCode: 400 });
  const sql = preferredId
    ? `SELECT c.id, ? AS selected_name FROM cities c
        WHERE c.country_code = 'KZ' AND c.id = ? AND (c.name_key = ? OR EXISTS (SELECT 1 FROM city_aliases ca WHERE ca.city_id = c.id AND ca.name_key = ? AND ca.language_code = 'ru')) LIMIT 1`
    : `SELECT c.id, ? AS selected_name FROM cities c
        WHERE c.country_code = 'KZ' AND (c.name_key = ? OR EXISTS (SELECT 1 FROM city_aliases ca WHERE ca.city_id = c.id AND ca.name_key = ? AND ca.language_code = 'ru')) LIMIT 1`;
  const nameKey = normalizeIdentity(cleanName);
  const queryParams = preferredId ? [cleanName, Number(preferredId), nameKey, nameKey] : [cleanName, nameKey, nameKey];
  const [[city]] = await connection.query(sql, queryParams);
  if (!city || !CYRILLIC_CITY_PATTERN.test(city.selected_name)) throw Object.assign(new Error("Выберите город из предложенного списка"), { statusCode: 400 });
  return { id: Number(city.id), name: city.selected_name };
}

export async function knownCities(connection, names) {
  const result = [];
  for (const name of names) result.push(await knownCity(connection, name));
  return result;
}
