import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import type { MentionRef } from "../../types/domain";

const NEUTRAL_MENTION_LABEL = "@пользователь";

type PositionedMention = { mention: MentionRef; start: number; end: number; order: number };

function findMentionPositions(text: string, mentions: MentionRef[]): PositionedMention[] {
  const used = new Set<string>();
  const found: PositionedMention[] = [];
  mentions.forEach((mention, order) => {
    const token = String(mention.token ?? "");
    if (!token) return;
    let from = 0;
    while (from <= text.length) {
      const start = text.indexOf(token, from);
      if (start < 0) return;
      const end = start + token.length;
      const key = `${start}:${end}`;
      if (!used.has(key)) {
        used.add(key);
        found.push({ mention, start, end, order });
        return;
      }
      from = start + Math.max(1, token.length);
    }
  });
  return found.sort((left, right) => left.start - right.start || left.end - right.end || left.order - right.order);
}

/** Renders only server-recorded tokens; it never reparses arbitrary @words. */
export function MentionText({ text, mentions = [], onOpenUser, className }: { text: string; mentions?: MentionRef[]; onOpenUser?: (userId: number) => void; className?: string }) {
  let cursor = 0;
  const parts: ReactNode[] = [];
  for (const positioned of findMentionPositions(text, mentions)) {
    if (positioned.start < cursor) continue;
    const { mention } = positioned;
    if (positioned.start > cursor) parts.push(text.slice(cursor, positioned.start));
    const label = mention.username ? `@${mention.username}` : NEUTRAL_MENTION_LABEL;
    parts.push(mention.username && onOpenUser ? <button type="button" className="mention-link" key={`${mention.userId}-${positioned.start}`} onClick={(event) => { event.stopPropagation(); onOpenUser(mention.userId); }}>{label}</button> : <span className="mention-neutral" key={`${mention.userId}-${positioned.start}`}>{label}</span>);
    cursor = positioned.end;
  }
  if (cursor < text.length || !parts.length) parts.push(text.slice(cursor));
  return <span className={className}>{parts}</span>;
}

/**
 * Decorates only the server-recorded mention tokens inside already-sanitized
 * rich HTML. It never scans arbitrary @words and keeps unavailable targets
 * neutral even if an old username remains in stored content.
 */
export function MentionRichText({ html, mentions = [], onOpenUser, onClick, className }: { html: string; mentions?: MentionRef[]; onOpenUser?: (userId: number) => void; onClick?: (event: MouseEvent<HTMLDivElement>) => void; className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mentionKey = mentions.map((mention) => `${mention.userId}:${mention.token}:${mention.username ?? ""}`).join("|");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.innerHTML = html;
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      textNodes.push(current as Text);
      current = walker.nextNode();
    }
    const fullText = textNodes.map((node) => node.nodeValue ?? "").join("");
    const positionedMentions = findMentionPositions(fullText, mentions);
    let textOffset = 0;
    for (const node of textNodes) {
      const source = node.nodeValue ?? "";
      const nodeStart = textOffset;
      const nodeEnd = nodeStart + source.length;
      textOffset = nodeEnd;
      const nodeMentions = positionedMentions.filter((positioned) => positioned.start >= nodeStart && positioned.end <= nodeEnd);
      if (!nodeMentions.length) continue;
      let cursor = 0;
      let changed = false;
      const fragment = document.createDocumentFragment();
      for (const positioned of nodeMentions) {
        if (positioned.start - nodeStart < cursor) continue;
        const mention = positioned.mention;
        const index = positioned.start - nodeStart;
        if (index > cursor) fragment.append(source.slice(cursor, index));
        const label = mention.username ? `@${mention.username}` : NEUTRAL_MENTION_LABEL;
        if (mention.username && onOpenUser) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "mention-link";
          button.dataset.mentionUserId = String(mention.userId);
          button.textContent = label;
          fragment.append(button);
        } else {
          const span = document.createElement("span");
          span.className = "mention-neutral";
          span.textContent = label;
          fragment.append(span);
        }
        cursor = positioned.end - nodeStart;
        changed = true;
      }
      if (!changed) continue;
      if (cursor < source.length) fragment.append(source.slice(cursor));
      node.replaceWith(fragment);
    }
  }, [html, mentionKey, onOpenUser]);

  return <div ref={rootRef} className={className} onClick={(event) => {
    const target = (event.target as Element).closest?.("[data-mention-user-id]");
    const userId = Number(target?.getAttribute("data-mention-user-id"));
    if (userId && onOpenUser) {
      event.stopPropagation();
      onOpenUser(userId);
      return;
    }
    onClick?.(event);
  }} dangerouslySetInnerHTML={{ __html: html }} />;
}
