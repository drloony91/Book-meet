import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../services/api";
import type { GroupCandidate, GroupDetail, GroupMessage, GroupSummary } from "../types/domain";

export type GroupSearchMatch = { messageId: number; snippet: string; createdAt: string; author?: { name: string } };
type GroupState = { detail: GroupDetail | null; messages: GroupMessage[]; loading: boolean; loadingOlder: boolean; nextCursor: number | null; error: string; searchResults: GroupSearchMatch[] };

async function json(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

/**
 * The group UI deliberately has its own projection.  In particular it never
 * falls back to the legacy bootstrap/direct-message projection when the
 * server-side rollout flag is absent.
 */
export function useGroupChats({ enabled, conversationId }: { enabled: boolean; conversationId: number | null }) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [state, setState] = useState<GroupState>({ detail: null, messages: [], loading: false, loadingOlder: false, nextCursor: null, error: "", searchResults: [] });
  const stateRef = useRef(state);
  const listVersion = useRef(0);
  const detailVersion = useRef(0);
  const listController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const lastReadSentRef = useRef(0);
  useEffect(() => { stateRef.current = state; }, [state]);

  const refreshList = useCallback(async () => {
    if (!enabled) { setGroups([]); return; }
    const version = ++listVersion.current;
    listController.current?.abort();
    const controller = new AbortController(); listController.current = controller;
    try {
      const response = await apiFetch("/api/group-conversations", { credentials: "same-origin", signal: controller.signal });
      const data = await json(response);
      if (controller.signal.aborted || version !== listVersion.current) return;
      if (!response.ok || !Array.isArray(data.conversations)) throw new Error(typeof data.error === "string" ? data.error : "GROUP_LIST_FAILED");
      setGroups(data.conversations as GroupSummary[]);
    } catch (error) {
      if (!controller.signal.aborted && version === listVersion.current) setGroups([]);
    }
  }, [enabled]);

  const refreshConversation = useCallback(async () => {
    if (!enabled || !conversationId) { setState({ detail: null, messages: [], loading: false, loadingOlder: false, nextCursor: null, error: "", searchResults: [] }); return; }
    const version = ++detailVersion.current;
    detailController.current?.abort();
    const controller = new AbortController(); detailController.current = controller;
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const [detailResponse, messagesResponse] = await Promise.all([
        apiFetch(`/api/group-conversations/${conversationId}`, { credentials: "same-origin", signal: controller.signal }),
        apiFetch(`/api/group-conversations/${conversationId}/messages`, { credentials: "same-origin", signal: controller.signal }),
      ]);
      const [detailData, messagesData] = await Promise.all([json(detailResponse), json(messagesResponse)]);
      if (controller.signal.aborted || version !== detailVersion.current) return;
      if (!detailResponse.ok || !messagesResponse.ok || !Number.isSafeInteger(detailData.id) || !Array.isArray(messagesData.messages)) throw new Error(typeof detailData.error === "string" ? detailData.error : "GROUP_NOT_FOUND");
      const detail = detailData as unknown as GroupDetail;
      const latest = messagesData.messages as GroupMessage[];
      setState((current) => {
        const sameGroup = current.detail?.id === detail.id;
        const sameBoundary = sameGroup && (current.detail?.historyClearedMessageId ?? 0) === (detail.historyClearedMessageId ?? 0);
        const loadedOlderPage = sameBoundary && current.messages.length > 0;
        const latestStartId = latest[0]?.id ?? Infinity;
        const preservedOlder = loadedOlderPage ? current.messages.filter((message) => message.id < latestStartId) : [];
        const merged = new Map([...preservedOlder, ...latest].map((message) => [message.id, message]));
        return { ...current, detail, messages: [...merged.values()].sort((a, b) => a.id - b.id), loading: false, loadingOlder: false, nextCursor: loadedOlderPage ? current.nextCursor : typeof messagesData.nextCursor === "number" ? messagesData.nextCursor : null, error: "" };
      });
    } catch (error) {
      if (!controller.signal.aborted && version === detailVersion.current) setState({ detail: null, messages: [], loading: false, loadingOlder: false, nextCursor: null, error: "GROUP_NOT_FOUND", searchResults: [] });
    }
  }, [conversationId, enabled]);

  useEffect(() => { void refreshList(); return () => listController.current?.abort(); }, [refreshList]);
  useEffect(() => { lastReadSentRef.current = 0; }, [conversationId]);
  useEffect(() => { void refreshConversation(); return () => detailController.current?.abort(); }, [refreshConversation]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { void refreshList(); void refreshConversation(); };
    window.addEventListener("bookmeet:group-chat-refresh", refresh);
    return () => window.removeEventListener("bookmeet:group-chat-refresh", refresh);
  }, [enabled, refreshConversation, refreshList]);

  const mutate = useCallback(async (path: string, method: string, body?: Record<string, unknown>) => {
    if (!enabled) return null;
    const response = await apiFetch(`/api${path}`, { method, credentials: "same-origin", body: body ? JSON.stringify(body) : undefined });
    const data = await json(response);
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "GROUP_REQUEST_FAILED");
    await Promise.all([refreshList(), refreshConversation()]);
    return data;
  }, [enabled, refreshConversation, refreshList]);

  const create = useCallback((name: string, participantIds: number[], avatarUrl?: string) => mutate("/group-conversations", "POST", { name, participantIds, avatarUrl }), [mutate]);
  const send = useCallback((body: string, attachment?: unknown, stickerId?: string) => conversationId ? mutate(`/group-conversations/${conversationId}/messages`, "POST", { body, attachment, stickerId }) : Promise.resolve(null), [conversationId, mutate]);
  const read = useCallback((messageId: number) => {
    if (!conversationId || messageId <= lastReadSentRef.current) return Promise.resolve({ ok: true, advanced: false });
    lastReadSentRef.current = messageId;
    return mutate(`/group-conversations/${conversationId}/read`, "PATCH", { messageId }).catch((error) => { lastReadSentRef.current = Math.min(lastReadSentRef.current, messageId - 1); throw error; });
  }, [conversationId, mutate]);
  const edit = useCallback((messageId: number, body: string) => conversationId ? mutate(`/group-conversations/${conversationId}/messages/${messageId}`, "PATCH", { body }) : Promise.resolve(null), [conversationId, mutate]);
  const remove = useCallback((messageId: number) => conversationId ? mutate(`/group-conversations/${conversationId}/messages/${messageId}`, "DELETE") : Promise.resolve(null), [conversationId, mutate]);
  const like = useCallback((messageId: number, liked: boolean) => conversationId ? mutate(`/group-conversations/${conversationId}/messages/${messageId}/reactions/like`, liked ? "DELETE" : "POST") : Promise.resolve(null), [conversationId, mutate]);
  const update = useCallback((body: Record<string, unknown>) => conversationId ? mutate(`/group-conversations/${conversationId}`, "PATCH", body) : Promise.resolve(null), [conversationId, mutate]);
  const addMember = useCallback((userId: number) => conversationId ? mutate(`/group-conversations/${conversationId}/members`, "POST", { userId }) : Promise.resolve(null), [conversationId, mutate]);
  const removeMember = useCallback((userId: number) => conversationId ? mutate(`/group-conversations/${conversationId}/members/${userId}`, "DELETE") : Promise.resolve(null), [conversationId, mutate]);
  const changeRole = useCallback((userId: number, role: "owner" | "moderator" | "member") => conversationId ? mutate(`/group-conversations/${conversationId}/members/${userId}/role`, "PATCH", { role }) : Promise.resolve(null), [conversationId, mutate]);
  const transferOwner = useCallback((userId: number) => conversationId ? mutate(`/group-conversations/${conversationId}/owner-transfer`, "POST", { userId }) : Promise.resolve(null), [conversationId, mutate]);
  const leave = useCallback(() => conversationId ? mutate(`/group-conversations/${conversationId}/leave`, "POST") : Promise.resolve(null), [conversationId, mutate]);
  const clearHistory = useCallback(() => conversationId ? mutate(`/group-conversations/${conversationId}/history/clear`, "POST") : Promise.resolve(null), [conversationId, mutate]);
  const deleteGroup = useCallback(() => conversationId ? mutate(`/group-conversations/${conversationId}`, "DELETE") : Promise.resolve(null), [conversationId, mutate]);
  const createPoll = useCallback((body: Record<string, unknown>) => conversationId ? mutate(`/group-conversations/${conversationId}/polls`, "POST", body) : Promise.resolve(null), [conversationId, mutate]);
  const vote = useCallback((pollId: number, optionIds: number[]) => conversationId ? mutate(`/group-conversations/${conversationId}/polls/${pollId}/vote`, "POST", { optionIds }) : Promise.resolve(null), [conversationId, mutate]);
  const search = useCallback(async (query: string) => {
    if (!enabled || !conversationId || !query.trim()) { setState((current) => ({ ...current, searchResults: [] })); return; }
    const response = await apiFetch(`/api/group-conversations/${conversationId}/messages/search?q=${encodeURIComponent(query.trim())}`, { credentials: "same-origin" });
    const data = await json(response);
    if (!response.ok || !Array.isArray(data.matches)) throw new Error(typeof data.error === "string" ? data.error : "GROUP_SEARCH_FAILED");
    setState((current) => ({ ...current, searchResults: data.matches as GroupSearchMatch[] }));
  }, [conversationId, enabled]);

  const candidates = useCallback(async (query: string): Promise<GroupCandidate[]> => {
    if (!enabled || !query.trim()) return [];
    const response = await apiFetch(`/api/group-conversations/candidates?q=${encodeURIComponent(query.trim())}`, { credentials: "same-origin" });
    const data = await json(response);
    if (!response.ok || !Array.isArray(data.users)) throw new Error(typeof data.error === "string" ? data.error : "GROUP_CANDIDATES_FAILED");
    return data.users as GroupCandidate[];
  }, [enabled]);

  const loadOlder = useCallback(async () => {
    const before = state.messages[0]?.id;
    if (!enabled || !conversationId || !before || state.loadingOlder || state.nextCursor === null) return;
    const clearBoundary = state.detail?.historyClearedMessageId ?? 0;
    setState((current) => ({ ...current, loadingOlder: true }));
    try {
      const response = await apiFetch(`/api/group-conversations/${conversationId}/messages?before=${before}`, { credentials: "same-origin" });
      const data = await json(response);
      if (!response.ok || !Array.isArray(data.messages)) throw new Error(typeof data.error === "string" ? data.error : "GROUP_HISTORY_FAILED");
      const older = data.messages as GroupMessage[];
      setState((current) => {
        if (current.detail?.id !== conversationId || (current.detail?.historyClearedMessageId ?? 0) !== clearBoundary) return current;
        const merged = new Map([...older, ...current.messages].map((message) => [message.id, message]));
        return { ...current, messages: [...merged.values()].sort((a, b) => a.id - b.id), loadingOlder: false, nextCursor: typeof data.nextCursor === "number" ? data.nextCursor : null };
      });
    } catch (error) {
      setState((current) => ({ ...current, loadingOlder: false, error: error instanceof Error ? error.message : "GROUP_HISTORY_FAILED" }));
    }
  }, [conversationId, enabled, state.loadingOlder, state.messages, state.nextCursor]);

  const loadThrough = useCallback(async (messageId: number) => {
    if (!enabled || !conversationId || stateRef.current.detail?.id !== conversationId || stateRef.current.messages.some((message) => message.id === messageId)) return;
    const clearBoundary = stateRef.current.detail.historyClearedMessageId ?? 0;
    const response = await apiFetch(`/api/group-conversations/${conversationId}/messages?before=${messageId + 1}`, { credentials: "same-origin" });
    const data = await json(response);
    if (!response.ok || !Array.isArray(data.messages)) throw new Error(typeof data.error === "string" ? data.error : "GROUP_HISTORY_FAILED");
    const older = data.messages as GroupMessage[];
    setState((current) => {
      if (current.detail?.id !== conversationId || (current.detail?.historyClearedMessageId ?? 0) !== clearBoundary) return current;
      const merged = new Map([...current.messages, ...older].map((message) => [message.id, message]));
      return { ...current, messages: [...merged.values()].sort((a, b) => a.id - b.id), nextCursor: typeof data.nextCursor === "number" ? data.nextCursor : null };
    });
  }, [conversationId, enabled]);

  return { groups, ...state, refreshList, refreshConversation, create, send, read, edit, remove, like, update, addMember, removeMember, changeRole, transferOwner, leave, clearHistory, deleteGroup, createPoll, vote, search, candidates, loadOlder, loadThrough };
}
