import type { BootstrapData, PublicCatalogData } from "../types/domain";
import { currentLocale, localizedApiError, translate } from "../i18n";
import { apiFetch } from "./api";
import { parsePublicCatalogData, requireJsonRecord } from "./response-validation.mjs";

export type BootstrapSection = "session" | "catalog" | "social" | "moderation";

export class BootstrapRequestError extends Error {
  constructor(public status: number, public data: Record<string, unknown>) {
    super(localizedApiError(data.error, translate(currentLocale(), "bootstrap.loadError")));
  }
}

async function loadSection(section: BootstrapSection) {
  const response = await apiFetch(`/api/bootstrap/${section}`, { cache: "no-store" });
  const raw: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const data = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    throw new BootstrapRequestError(response.status, data);
  }
  let data: Record<string, unknown>;
  try {
    data = requireJsonRecord(raw);
  } catch {
    throw new BootstrapRequestError(response.status, { error: translate(currentLocale(), "bootstrap.loadError") });
  }
  return data;
}

export async function loadApplicationData(sections: BootstrapSection[] = ["session", "catalog", "social", "moderation"]): Promise<BootstrapData> {
  const parts = await Promise.all(sections.map(loadSection));
  return Object.assign({}, ...parts) as BootstrapData;
}

export async function loadPublicCatalog(): Promise<PublicCatalogData> {
  const response = await apiFetch("/api/public/catalog", { cache: "no-store" });
  const raw: unknown = await response.json().catch(() => undefined);
  const errorData = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as { error?: string } : {};
  if (!response.ok) throw new Error(localizedApiError(errorData.error, translate(currentLocale(), "catalog.publicLoadError")));
  try {
    return parsePublicCatalogData(raw);
  } catch {
    throw new Error(translate(currentLocale(), "catalog.publicLoadError"));
  }
}
