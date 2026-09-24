import { forwardRef, KeyboardEvent, TextareaHTMLAttributes, useEffect, useImperativeHandle, useRef, useState } from "react";
import { apiFetch } from "../../services/api";
import type { MentionRef } from "../../types/domain";

export type MentionUser = { id: number; username: string; displayName: string };

export const MentionTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { mentionUserIds: number[]; onMentionUserIdsChange: (ids: number[]) => void; mentionRefs?: MentionRef[]; onMentionRefsChange?: (refs: MentionRef[]) => void }>(function MentionTextarea({ mentionUserIds, onMentionUserIdsChange, mentionRefs = [], onMentionRefsChange, ...props }, forwardedRef) {
  const [suggestions, setSuggestions] = useState<MentionUser[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLTextAreaElement);
  const query = () => {
    const node = inputRef.current; const before = node?.value.slice(0, node.selectionStart) ?? "";
    return before.match(/@([\w.-]{1,30})$/)?.[1] ?? "";
  };
  useEffect(() => {
    const value = props.value ?? ""; const match = String(value).match(/@([\w.-]{1,30})$/);
    if (!match) { setSuggestions([]); return; }
    const timer = window.setTimeout(async () => {
      const response = await apiFetch(`/api/users/mentions?q=${encodeURIComponent(match[1])}`, { credentials: "same-origin" });
      const data = await response.json() as { users?: MentionUser[] };
      if (response.ok) { setSuggestions(data.users ?? []); setSelected(0); }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [props.value]);
  const choose = (user: MentionUser) => {
    const node = inputRef.current; if (!node) return;
    const before = node.value.slice(0, node.selectionStart).replace(/@[\w.-]*$/, `@${user.username} `);
    const next = `${before}${node.value.slice(node.selectionStart)}`;
    props.onChange?.({ target: { value: next } } as never);
    onMentionUserIdsChange([...new Set([...mentionUserIds, user.id])]);
    onMentionRefsChange?.([...mentionRefs.filter((item) => item.userId !== user.id), { userId: user.id, token: `@${user.username}`, username: user.username, displayName: user.displayName }]); setSuggestions([]);
    requestAnimationFrame(() => { node.focus(); node.setSelectionRange(before.length, before.length); });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggestions.length) { props.onKeyDown?.(event); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSelected((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length); return; }
    if (event.key === "Enter") { event.preventDefault(); choose(suggestions[selected]); return; }
    if (event.key === "Escape") { event.preventDefault(); setSuggestions([]); return; }
    props.onKeyDown?.(event);
  };
  return <div className="mention-textarea"><textarea {...props} ref={inputRef} onKeyDown={onKeyDown} />{suggestions.length > 0 && <ul className="mention-suggestions" role="listbox">{suggestions.map((user, index) => <li key={user.id} role="option" aria-selected={index === selected}><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(user)}>{user.displayName} <span>@{user.username}</span></button></li>)}</ul>}</div>;
});
