import { useState } from "react";
import type { MainView, RoutableMainView } from "../../navigation/routes";
import type { UserProfileData } from "../../types/domain";

const sections: Array<{ view: RoutableMainView; label: string }> = [
  { view: "home", label: "Лента" },
  { view: "events", label: "События" },
  { view: "reviews", label: "Рецензии" },
  { view: "publications", label: "Блог" },
  { view: "occasions", label: "Поводы" },
];

export function ContentHubControls({ view, profileType, onNavigate, onEvent, onReview, onPublication, onOccasion, onPublisherNews }: {
  view: MainView;
  profileType: UserProfileData["type"];
  onNavigate: (view: RoutableMainView) => void;
  onEvent: () => void;
  onReview: () => void;
  onPublication: () => void;
  onOccasion: () => void;
  onPublisherNews: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!["home", "events", "reviews", "publications", "occasions"].includes(view)) return null;
  const publisher = profileType === "Издатель";
  return <>
    <nav className="content-hub-switch" aria-label="Разделы главной страницы">
      <span className={`content-hub-indicator at-${sections.findIndex((item) => item.view === view)}`} aria-hidden="true" />
      {sections.map((item) => <button key={item.view} className={view === item.view ? "active" : ""} type="button" onClick={() => onNavigate(item.view)}>{item.label}</button>)}
    </nav>
    <div className={`floating-create ${open ? "is-open" : ""}`}>
      <div className="floating-create-menu" aria-hidden={!open}>
        {(profileType !== "Читатель") && <button type="button" onClick={onEvent}>Добавить событие</button>}
        {!publisher && profileType !== "Писатель" && <button type="button" onClick={onReview}>Написать рецензию</button>}
        {!publisher && (profileType === "Писатель" || profileType === "Блогер") && <button type="button" onClick={onPublication}>Создать публикацию</button>}
        {!publisher && <button type="button" onClick={onOccasion}>Предложить повод</button>}
        {publisher && <button type="button" onClick={onPublisherNews}>Опубликовать новость</button>}
      </div>
      <button className="floating-create-toggle" type="button" aria-expanded={open} aria-label={open ? "Закрыть меню создания" : "Создать материал"} onClick={() => setOpen((value) => !value)}><span>+</span></button>
    </div>
  </>;
}
