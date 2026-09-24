import { useEffect, useState } from "react";
import { CustomSelect } from "../common/CustomSelect";
import { useI18n } from "../../i18n";
import { apiFetch } from "../../services/api";
import { useReadingSessionsFeature } from "./ReadingSessionContext";

type Audience = "nobody" | "friends" | "followers" | "everyone";
const audienceValues: Audience[] = ["nobody", "friends", "followers", "everyone"];
const copy = {
  ru: { title: "Присутствие «читает сейчас»", hint: "Ваш аватар виден только во время активного таймера и лишь выбранной аудитории, если ей доступна книга.", loading: "Загрузка…", saving: "Сохранение…", error: "Не удалось сохранить настройку присутствия", nobody: "Никому", friends: "Друзьям", followers: "Подписчикам", everyone: "Всем допустимым пользователям" },
  kk: { title: "«Қазір оқып жатыр» мәртебесі", hint: "Аватарыңыз тек таймер жұмыс істеп тұрған кезде, кітап қолжетімді таңдалған адамдарға ғана көрінеді.", loading: "Жүктелуде…", saving: "Сақталуда…", error: "Оқу мәртебесінің баптауын сақтау мүмкін болмады", nobody: "Ешкімге", friends: "Достарға", followers: "Жазылушыларға", everyone: "Рұқсат етілген барлығына" },
  en: { title: "Reading now presence", hint: "Your avatar appears only while the timer is running, to the selected audience when they can access the book.", loading: "Loading…", saving: "Saving…", error: "Could not save reading presence setting", nobody: "Nobody", friends: "Friends", followers: "Followers", everyone: "Everyone allowed" },
} as const;

export function ReadingPresencePreference() {
  const enabled = useReadingSessionsFeature();
  const { locale } = useI18n();
  const labels = copy[locale];
  const [audience, setAudience] = useState<Audience>("nobody");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void apiFetch("/api/reading-presence/preferences", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("reading presence preference unavailable");
      const payload = await response.json() as { visibility?: Audience };
      if (!audienceValues.includes(payload.visibility as Audience)) throw new Error("invalid reading presence preference");
      if (active) { setAudience(payload.visibility as Audience); setLoaded(true); }
    }).catch(() => { if (active) { setError(labels.error); setLoaded(true); } });
    return () => { active = false; };
  }, [enabled, labels.error]);
  if (!enabled) return null;

  const change = async (next: Audience) => {
    if (saving || next === audience) return;
    setSaving(true); setError("");
    try {
      const response = await apiFetch("/api/reading-presence/preferences", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility: next }) });
      if (!response.ok) throw new Error("reading presence preference save failed");
      const payload = await response.json() as { visibility?: Audience };
      if (payload.visibility !== next) throw new Error("reading presence preference mismatch");
      setAudience(next);
    } catch { setError(labels.error); }
    finally { setSaving(false); }
  };
  return <section className="profile-edit-settings-section profile-privacy-settings"><h2>{labels.title}</h2><label>{labels.title}<CustomSelect ariaLabel={labels.title} value={audience} onChange={(value) => void change(value)} disabled={!loaded || saving} options={audienceValues.map((value) => ({ value, label: labels[value] }))} /><small>{labels.hint}</small><span role="status" aria-live="polite">{!loaded ? labels.loading : saving ? labels.saving : error ? labels.error : ""}</span></label></section>;
}
