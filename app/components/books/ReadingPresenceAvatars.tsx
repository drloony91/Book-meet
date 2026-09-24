import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { apiFetch } from "../../services/api";
import "./reading-presence.css";

type Avatar = { userId: number; initials: string; color: string; avatarUrl: string | null };
type SelfAvatar = { id: number; initials: string; color: string; avatarUrl?: string };

export function ReadingPresenceAvatars({ bookId, running, self }: { bookId: number; running: boolean; self: SelfAvatar }) {
  const { locale } = useI18n();
  const [others, setOthers] = useState<Avatar[]>([]);
  useEffect(() => {
    if (!running) { setOthers([]); return; }
    let active = true;
    let revision = 0;
    const refresh = () => {
      if (document.hidden) return;
      const requestRevision = ++revision;
      void apiFetch(`/api/books/${bookId}/reading-presence`, { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("reading presence unavailable");
        const payload = await response.json() as { readers?: unknown };
        if (!Array.isArray(payload.readers)) throw new Error("invalid reading presence response");
        const readers = payload.readers.filter((item): item is Avatar => Boolean(item && typeof item === "object" && Number.isSafeInteger((item as Avatar).userId) && typeof (item as Avatar).initials === "string" && typeof (item as Avatar).color === "string" && ((item as Avatar).avatarUrl === null || typeof (item as Avatar).avatarUrl === "string")));
        if (active && requestRevision === revision) setOthers(readers.filter((reader) => reader.userId !== self.id).slice(0, 24));
      }).catch(() => { if (active && requestRevision === revision) setOthers([]); });
    };
    const visible = () => { if (!document.hidden) refresh(); };
    refresh();
    const timer = window.setInterval(refresh, 20_000);
    window.addEventListener("bookmeet:reading-presence-refresh", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("bookmeet:reading-presence-refresh", refresh); document.removeEventListener("visibilitychange", visible); };
  }, [bookId, running, self.id]);
  const avatars = [{ userId: self.id, initials: self.initials, color: self.color, avatarUrl: self.avatarUrl ?? null }, ...others];
  const label = locale === "ru" ? `Сейчас читают эту книгу: ${avatars.length}` : locale === "kk" ? `Бұл кітапты қазір оқып жатқандар: ${avatars.length}` : `Reading this book now: ${avatars.length}`;
  return <div className="reading-presence-field" aria-label={label} role="group">{avatars.map((avatar, index) => <span key={avatar.userId} className="reading-presence-motion" style={{ animationDuration: `${7 + index % 4 * 1.7}s, ${9 + index % 5 * 1.3}s`, animationDelay: `${-index * 1.1}s, ${-index * 1.7}s` }} aria-hidden="true"><span className={`avatar reading-presence-avatar avatar-${avatar.color} ${avatar.avatarUrl ? "has-photo" : ""}`} style={avatar.avatarUrl ? { backgroundImage: `url(${avatar.avatarUrl})` } : undefined}>{!avatar.avatarUrl && <span className="reading-presence-placeholder" />}</span></span>)}</div>;
}
