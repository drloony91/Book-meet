import { useEffect, useRef, useState } from "react";
import type { MainView, RoutableMainView } from "../../navigation/routes";
import type { UserProfileData } from "../../types/domain";
import { useI18n, type Translate } from "../../i18n";

const sections = (t: Translate): Array<{ view: RoutableMainView; label: string }> => [
  { view: "home", label: t("content.feed") },
  { view: "events", label: t("content.events") },
  { view: "reviews", label: t("content.reviews") },
  { view: "publications", label: t("content.blog") },
  { view: "occasions", label: t("content.occasionsShort") },
];

export function ContentHubControls({ view, profileType, showSwitch = true, onNavigate, onEvent, onReview, onPublication, onOccasion, onPublisherNews }: {
  view: MainView;
  profileType: UserProfileData["type"];
  showSwitch?: boolean;
  onNavigate: (view: RoutableMainView) => void;
  onEvent: () => void;
  onReview: () => void;
  onPublication: () => void;
  onOccasion: () => void;
  onPublisherNews: () => void;
}) {
  const { t } = useI18n();
  const localizedSections = sections(t);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  const choose = (action: () => void) => { setOpen(false); action(); };
  if (!["home", "events", "reviews", "publications", "occasions"].includes(view)) return null;
  const normalizedProfileType = profileType.trim();
  const reader = normalizedProfileType === "Читатель";
  const blogger = normalizedProfileType === "Блогер";
  const publisher = normalizedProfileType === "Издатель" || normalizedProfileType === "Сообщество";
  return <>
    {showSwitch && <nav className="content-hub-switch" aria-label={t("content.homeSections")}>
      <span className={`content-hub-indicator at-${localizedSections.findIndex((item) => item.view === view)}`} aria-hidden="true" />
      {localizedSections.map((item) => <button key={item.view} className={view === item.view ? "active" : ""} type="button" onClick={() => onNavigate(item.view)}>{item.label}</button>)}
    </nav>}
    <div ref={rootRef} className={`floating-create ${open ? "is-open" : ""}`}>
      <div className="floating-create-menu" aria-hidden={!open}>
        <button type="button" data-material-action="event" onClick={() => choose(onEvent)}>{t("content.createEvent")}</button>
        {(reader || blogger) && <button type="button" data-material-action="review" onClick={() => choose(onReview)}>{t("content.createReview")}</button>}
        {!publisher && <button type="button" onClick={() => choose(onPublication)}>{t("content.createPublication")}</button>}
        {!publisher && <button type="button" onClick={() => choose(onOccasion)}>{t("content.createOccasion")}</button>}
        {publisher && <button type="button" onClick={() => choose(onPublisherNews)}>{t("content.publishNews")}</button>}
      </div>
      <button className="floating-create-toggle" type="button" aria-expanded={open} aria-label={open ? t("content.closeCreateMenu") : t("content.createMaterial")} onClick={() => setOpen((value) => !value)}><span aria-hidden="true">+</span></button>
    </div>
  </>;
}
