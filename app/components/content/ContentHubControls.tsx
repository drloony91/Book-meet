import { useEffect, useRef, useState } from "react";
import type { MainView, RoutableMainView } from "../../navigation/routes";
import type { UserProfileData } from "../../types/domain";

const sections: Array<{ view: RoutableMainView; label: string }> = [
  { view: "home", label: "Лента" },
  { view: "events", label: "События" },
  { view: "reviews", label: "Рецензии" },
  { view: "publications", label: "Блог" },
  { view: "occasions", label: "Поводы" },
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
    {showSwitch && <nav className="content-hub-switch" aria-label="Разделы главной страницы">
      <span className={`content-hub-indicator at-${sections.findIndex((item) => item.view === view)}`} aria-hidden="true" />
      {sections.map((item) => <button key={item.view} className={view === item.view ? "active" : ""} type="button" onClick={() => onNavigate(item.view)}>{item.label}</button>)}
    </nav>}
    <div ref={rootRef} className={`floating-create ${open ? "is-open" : ""}`}>
      <div className="floating-create-menu" aria-hidden={!open}>
        <button type="button" data-material-action="event" onClick={() => choose(onEvent)}>Добавить событие</button>
        {(reader || blogger) && <button type="button" data-material-action="review" onClick={() => choose(onReview)}>Написать рецензию</button>}
        {!publisher && (normalizedProfileType === "Писатель" || blogger) && <button type="button" onClick={() => choose(onPublication)}>Создать публикацию</button>}
        {!publisher && <button type="button" onClick={() => choose(onOccasion)}>Предложить повод</button>}
        {publisher && <button type="button" onClick={() => choose(onPublisherNews)}>Опубликовать новость</button>}
      </div>
      <button className="floating-create-toggle" type="button" aria-expanded={open} aria-label={open ? "Закрыть меню создания" : "Создать материал"} onClick={() => setOpen((value) => !value)}><span aria-hidden="true">+</span></button>
    </div>
  </>;
}
