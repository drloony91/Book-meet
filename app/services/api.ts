import { currentLocale, localizedApiError, translate } from "../i18n";

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const locale = currentLocale();
  const localeHeaders = { "Accept-Language": locale, "X-BookMeet-Locale": locale };
  return fetch(input, {
    credentials: "same-origin",
    ...init,
    headers: init.body && !(init.body instanceof FormData)
      ? { "content-type": "application/json", ...localeHeaders, ...init.headers }
      : { ...localeHeaders, ...init.headers },
  });
}

export async function apiJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(input, init);
  const data = await response.json().catch(() => ({})) as T;
  if (!response.ok) {
    const code = typeof data === "object" && data && "code" in data ? String((data as { code?: unknown }).code ?? "") : "";
    const knownCodes: Record<string, Parameters<typeof translate>[1]> = { NOT_FOUND: "common.nothingFound", TOP3_LIMIT: "content.top3" };
    const message = code && knownCodes[code]
      ? translate(currentLocale(), knownCodes[code])
      : typeof data === "object" && data && "error" in data
        ? localizedApiError((data as { error?: unknown }).error, translate(currentLocale(), "common.error"))
        : translate(currentLocale(), "common.error");
    throw Object.assign(new Error(message), { response, data });
  }
  return data;
}

export function jsonBody(value: unknown) {
  return JSON.stringify(value);
}
