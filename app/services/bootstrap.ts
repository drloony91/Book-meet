import type { BootstrapData, PublicCatalogData } from "../types/domain";
import { currentLocale, localizedApiError, translate } from "../i18n";
import { apiFetch } from "./api";

export type BootstrapSection = "session" | "catalog" | "social" | "moderation";

export class BootstrapRequestError extends Error {
  constructor(public status: number, public data: Record<string, unknown>) {
    super(localizedApiError(data.error, translate(currentLocale(), "bootstrap.loadError")));
  }
}

async function loadSection(section: BootstrapSection) {
  const response = await apiFetch(`/api/bootstrap/${section}`, { cache: "no-store" });
  const data = await response.json().catch(() => ({})) as Partial<BootstrapData> & Record<string, unknown>;
  if (!response.ok) throw new BootstrapRequestError(response.status, data);
  return data;
}

export async function loadApplicationData(sections: BootstrapSection[] = ["session", "catalog", "social", "moderation"]): Promise<BootstrapData> {
  const parts = await Promise.all(sections.map(loadSection));
  return Object.assign({}, ...parts) as BootstrapData;
}

export async function loadPublicCatalog(): Promise<PublicCatalogData> {
  const response = await apiFetch("/api/public/catalog", { cache: "no-store" });
  const data = await response.json().catch(() => ({})) as Partial<PublicCatalogData> & { error?: string };
  if (!response.ok) throw new Error(localizedApiError(data.error, translate(currentLocale(), "catalog.publicLoadError")));
  return {
    books: data.books ?? [],
    materials: data.materials ?? [],
    events: data.events ?? [],
    occasions: data.occasions ?? [],
    organizations: data.organizations ?? [],
  };
}
