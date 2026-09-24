const MIN_LOADING_MS = 3_000;

export function conversationKey(firstId: number, secondId: number) {
  return [firstId, secondId].sort((a, b) => a - b).join("-");
}

export async function finishMinimumLoading(startedAt: number) {
  const remaining = MIN_LOADING_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
}
