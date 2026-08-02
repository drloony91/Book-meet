export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, {
    credentials: "same-origin",
    ...init,
    headers: init.body && !(init.body instanceof FormData)
      ? { "content-type": "application/json", ...init.headers }
      : init.headers,
  });
}

export async function apiJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(input, init);
  const data = await response.json().catch(() => ({})) as T;
  if (!response.ok) {
    const message = typeof data === "object" && data && "error" in data
      ? String((data as { error?: unknown }).error || "Ошибка запроса")
      : "Ошибка запроса";
    throw Object.assign(new Error(message), { response, data });
  }
  return data;
}

export function jsonBody(value: unknown) {
  return JSON.stringify(value);
}
