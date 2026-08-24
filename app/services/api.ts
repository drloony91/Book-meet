import { currentLocale } from "../i18n";

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
