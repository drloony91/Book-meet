import { currentLocale } from "../i18n";

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const locale = currentLocale();
  const localeHeaders = { "Accept-Language": locale, "X-BookMeet-Locale": locale };
  const response = await fetch(input, {
    credentials: "same-origin",
    ...init,
    headers: init.body && !(init.body instanceof FormData)
      ? { "content-type": "application/json", ...localeHeaders, ...init.headers }
      : { ...localeHeaders, ...init.headers },
  });
  if (response.status === 428) {
    const payload = await response.clone().json().catch(() => ({})) as { code?: string };
    if (payload.code === "PROFILE_COMPLETION_REQUIRED") window.dispatchEvent(new CustomEvent("bookmeet:profile-completion-required"));
  }
  return response;
}
