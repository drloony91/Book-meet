"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicCatalogData } from "../types/domain";
import { safeReturnTo } from "../lib/navigation-security";

type GuestView = "home" | "books" | "publishing" | "communities" | "partners";

const paths: Record<GuestView, string> = { home: "/", books: "/books", publishing: "/publishing", communities: "/communities", partners: "/partners" };

function guestView(pathname: string): GuestView {
  const entry = Object.entries(paths).find(([, path]) => path === pathname.replace(/\/+$/, "") || path === "/" && pathname === "/");
  return entry ? entry[0] as GuestView : "home";
}

export function GuestExperience({ data, onAuthenticate }: { data: PublicCatalogData; onAuthenticate: (returnTo?: string) => void }) {
  const [view, setView] = useState<GuestView>(() => guestView(window.location.pathname));
  const [feedKind, setFeedKind] = useState<"materials" | "events">("materials");
  const authenticate = () => onAuthenticate(safeReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`));
  const navigate = (next: GuestView) => {
    window.history.pushState({}, "", paths[next]);
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  useEffect(() => {
    const restore = () => {
      const exact = Object.values(paths).includes(window.location.pathname as (typeof paths)[GuestView]);
      if (!exact) { authenticate(); return; }
      setView(guestView(window.location.pathname));
    };
    if (!Object.values(paths).includes(window.location.pathname as (typeof paths)[GuestView])) authenticate();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const organizations = useMemo(() => data.organizations.filter((organization) => view === "publishing" ? organization.type === "Издатель" : view === "communities" ? organization.type === "Сообщество" : false), [data.organizations, view]);

  return <div className="book-meet-app guest-app">
    <header className="topbar guest-topbar">
      <button className="brand brand-header-logo" type="button" onClick={() => navigate("home")} aria-label="Book Meet — на главную"><img src="/book-meet-header-logo-v3.png" alt="" /></button>
      <nav className="topbar-menu topbar-menu-left"><button type="button" onClick={() => navigate("books")}>Все книги</button><button type="button" onClick={() => navigate("publishing")}>Новинки издательств</button></nav>
      <nav className="topbar-menu topbar-menu-right"><button type="button" onClick={() => navigate("communities")}>Книжные сообщества</button><button type="button" onClick={() => navigate("partners")}>Наши партнеры</button></nav>
      <div className="topbar-account-actions guest-account-actions"><button className="notification-button" type="button" onClick={authenticate} aria-label="Уведомления доступны после входа">🔔</button><button className="primary-button guest-login-button" type="button" onClick={authenticate}>Вход/Регистрация</button></div>
    </header>
    <nav className="guest-mobile-nav" aria-label="Публичные разделы"><button type="button" className={view === "home" ? "active" : ""} onClick={() => navigate("home")}>Главная</button><button type="button" className={view === "books" ? "active" : ""} onClick={() => navigate("books")}>Все книги</button><button type="button" className={view === "publishing" ? "active" : ""} onClick={() => navigate("publishing")}>Издательства</button><button type="button" className={view === "communities" ? "active" : ""} onClick={() => navigate("communities")}>Сообщества</button><button type="button" className={view === "partners" ? "active" : ""} onClick={() => navigate("partners")}>Партнёры</button></nav>
    <main className="guest-content">
      {view === "home" && <>
        <section className="guest-hero"><span className="section-subtitle">Book Meet</span><h1>Встречаемся благодаря книгам</h1><p>Читайте публичную ленту и каталог. Для общения и публикации войдите или зарегистрируйтесь.</p><div><button className="primary-button" type="button" onClick={authenticate}>＋ Добавить материал</button><button className="outline-button" type="button" onClick={authenticate}>Найти друзей</button><button className="outline-button" type="button" onClick={authenticate}>Книжный повод</button><button className="outline-button" type="button" onClick={authenticate}>Поддержка</button></div></section>
        <div className="guest-feed-switch" role="group" aria-label="Переключить ленту"><button className={feedKind === "materials" ? "active" : ""} type="button" onClick={() => setFeedKind("materials")}>Материалы</button><button className={feedKind === "events" ? "active" : ""} type="button" onClick={() => setFeedKind("events")}>События</button></div>
        {feedKind === "materials" ? <section className="guest-card-grid">{data.materials.map((item) => <button className="guest-material-card" type="button" key={`${item.kind}-${item.id}`} onClick={authenticate}><span>{item.kind === "review" ? "Рецензия" : item.kind === "excerpt" ? "Публикация" : "Новость издательства"}</span><h2>{item.title}</h2><p>{item.preview}</p><small>{item.ownerName}</small></button>)}</section> : <section className="guest-card-grid">{data.events.map((item) => <button className="guest-event-card" type="button" key={item.id} onClick={authenticate}><span>{item.date} · {item.time} · {item.city}</span><h2>{item.title}</h2><p>{item.summary}</p><small>{item.address}</small></button>)}</section>}
      </>}
      {view === "books" && <section className="directory-page"><div className="directory-heading"><div><h1>Все книги</h1><p>{data.books.length} книг в публичном каталоге</p></div></div><div className="all-books-grid">{data.books.map((book) => <article className="library-book material-clickable-card" role="button" tabIndex={0} key={book.id} onClick={authenticate} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") authenticate(); }}><div className="all-books-cover-frame"><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div></div><div className="library-book-copy"><h3>{book.title}</h3><p>{book.author}</p><small>В библиотеках: {book.popularity}</small></div></article>)}</div></section>}
      {view === "partners" && <section className="directory-page"><div className="directory-heading"><div><h1>Наши партнеры</h1><p>Проекты и организации, которые помогают развивать книжную культуру.</p></div></div><div className="content-empty"><span aria-hidden="true">···</span><h3>Здесь пока ничего нет</h3></div></section>}
      {(view === "publishing" || view === "communities") && <section className="directory-page"><div className="directory-heading"><div><h1>{view === "publishing" ? "Издательства" : "Книжные сообщества"}</h1><p>{organizations.length} подтвержденных организаций</p></div></div><div className="organization-directory-grid">{organizations.map((organization) => <button className="organization-directory-card" type="button" key={organization.id} onClick={authenticate}><span className={`avatar avatar-md avatar-${organization.color} ${organization.avatarUrl ? "has-photo" : ""}`} style={organization.avatarUrl ? { backgroundImage: `url(${organization.avatarUrl})` } : undefined}>{!organization.avatarUrl && organization.initials}</span><span><small>{organization.type}{organization.communityType ? ` · ${organization.communityType}` : ""}</small><h2>{organization.name}</h2><p>{organization.city}</p><p>{organization.bio}</p></span></button>)}</div></section>}
    </main>
  </div>;
}
