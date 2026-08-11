"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyContentState } from "../components/common/EmptyContentState";
import { ContentHubControls } from "../components/content/ContentHubControls";
import { EventCard, MaterialPreviewCard } from "../components/content/ContentComponents";
import { BookMeetHeader, WorkspaceScreen } from "../components/layout/AppLayout";
import type { Friend } from "../components/chat/types";
import { safeReturnTo } from "../lib/navigation-security";
import type { MainView } from "../navigation/routes";
import { AllBooksDirectoryPage, SimpleDirectoryPage } from "./ContentScreens";
import { PublicOrganizationDirectoryPage } from "./UsersDirectoryScreen";
import type { BookEvent, PublicCatalogData, PublicCatalogEvent, PublicCatalogMaterial, ReadingItem } from "../types/domain";

type GuestView = "home" | "books" | "publishing" | "communities" | "partners";

const paths: Record<GuestView, string> = { home: "/", books: "/books", publishing: "/publishing", communities: "/communities", partners: "/partners" };
const supportFriend: Friend = { id: -1, name: "Служба поддержки", type: "Читатель", city: "Book Meet", initials: "", color: "blue", online: true, lastMessage: "Мы всегда готовы помочь", time: "", bio: "", books: "", support: true };

function guestView(pathname: string): GuestView {
  const clean = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  return (Object.entries(paths).find(([, path]) => path === clean)?.[0] as GuestView | undefined) ?? "home";
}

function readingItem(item: PublicCatalogMaterial): ReadingItem {
  return { id: item.id, kind: item.kind === "review" ? "review" : "excerpt", title: item.title, author: item.ownerName, text: item.preview, preview: item.preview, createdAt: item.createdAt };
}

function bookEvent(item: PublicCatalogEvent): BookEvent {
  return { id: item.id, creatorId: 0, title: item.title, summary: item.summary, description: item.summary, date: item.date, time: item.time, city: item.city, address: item.address, mapUrl: "", detailsUrl: "", status: "published", createdAt: item.createdAt ?? `${item.date}T${item.time || "00:00"}:00` };
}

type GuestHubView = "home" | "events" | "reviews" | "publications" | "occasions";

function GuestHome({ data, authenticate, onNavigate }: { data: PublicCatalogData; authenticate: () => void; onNavigate: (view: GuestHubView) => void }) {
  const materials = useMemo(() => data.materials.map((source) => ({ source, item: readingItem(source) })), [data.materials]);
  const events = useMemo(() => data.events.map(bookEvent), [data.events]);
  const feed = useMemo(() => [
    ...materials.map((entry) => ({ kind: "material" as const, time: Date.parse(entry.source.createdAt ?? "") || entry.source.id, entry })),
    ...events.map((item) => ({ kind: "event" as const, time: Date.parse(item.createdAt) || item.id, item })),
  ].sort((first, second) => second.time - first.time), [events, materials]);
  const reviews = materials.filter(({ source }) => source.kind === "review");
  const blog = materials.filter(({ source }) => source.kind !== "review");
  const materialCard = ({ source, item }: (typeof materials)[number], index: number) => <MaterialPreviewCard key={`${source.kind}-${source.id}`} item={item} index={index} kindLabel={source.kind === "publisher_news" ? "Новость издательства" : undefined} onOpen={authenticate} onOpenUser={() => undefined} onOpenAuthor={authenticate} />;
  return <main className="content-scroll home-content home-mode-feed">
    <section className="content-section home-feed">{feed.map((entry, index) => entry.kind === "event" ? <EventCard key={`event-${entry.item.id}`} item={entry.item} own={false} onOpen={authenticate} /> : materialCard(entry.entry, index))}{!feed.length && <EmptyContentState />}</section>
    <section className="content-section events-section"><div className="section-heading"><button className="home-section-link" type="button" onClick={() => onNavigate("events")}>Книжные события</button></div>{events.length ? <div className="events-grid">{events.slice(0, 2).map((item) => <EventCard key={item.id} item={item} own={false} onOpen={authenticate} />)}</div> : <EmptyContentState />}</section>
    <section className="content-section"><div className="section-heading"><button className="home-section-link" type="button" onClick={() => onNavigate("reviews")}>Рецензии</button></div>{reviews.length ? <div className="excerpt-grid review-material-grid">{reviews.map(materialCard)}</div> : <EmptyContentState />}</section>
    <section className="content-section"><div className="section-heading"><button className="home-section-link" type="button" onClick={() => onNavigate("publications")}>Публикации блога</button></div>{blog.length ? <div className="excerpt-grid">{blog.map(materialCard)}</div> : <EmptyContentState />}</section>
    <section className="content-section occasions-section"><div className="section-heading"><button className="home-section-link" type="button" onClick={() => onNavigate("occasions")}>Поводы познакомиться</button></div><EmptyContentState /></section>
  </main>;
}

function GuestHubDirectory({ view, data, authenticate }: { view: Exclude<GuestHubView, "home">; data: PublicCatalogData; authenticate: () => void }) {
  const materials = data.materials.filter((item) => view === "reviews" ? item.kind === "review" : view === "publications" ? item.kind !== "review" : false);
  const heading = view === "events" ? "Книжные события" : view === "reviews" ? "Рецензии" : view === "publications" ? "Публикации" : "Поводы познакомиться";
  return <main className="content-scroll directory-page"><div className="directory-heading"><div><h1>{heading}</h1></div></div>
    {view === "events" && (data.events.length ? <div className="events-grid">{data.events.map((item) => <EventCard key={item.id} item={bookEvent(item)} own={false} onOpen={authenticate} />)}</div> : <EmptyContentState />)}
    {(view === "reviews" || view === "publications") && (materials.length ? <div className={`excerpt-grid ${view === "reviews" ? "review-material-grid" : ""}`}>{materials.map((source, index) => <MaterialPreviewCard key={`${source.kind}-${source.id}`} item={readingItem(source)} index={index} kindLabel={source.kind === "publisher_news" ? "Новость издательства" : undefined} onOpen={authenticate} onOpenUser={() => undefined} onOpenAuthor={authenticate} />)}</div> : <EmptyContentState />)}
    {view === "occasions" && <EmptyContentState />}
  </main>;
}

export function GuestExperience({ data, onAuthenticate }: { data: PublicCatalogData; onAuthenticate: (returnTo?: string) => void }) {
  const [view, setView] = useState<GuestView>(() => guestView(window.location.pathname));
  const [hubView, setHubView] = useState<GuestHubView>("home");
  const authenticate = () => onAuthenticate(safeReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`));
  const navigate = (next: GuestView) => {
    window.history.pushState({}, "", paths[next]);
    setView(next);
    if (next === "home") setHubView("home");
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
  const directoryShell = (content: ReactNode) => <div className="directory-page-shell"><button className="back-button directory-home-button" type="button" onClick={() => navigate("home")}>← На главную</button>{content}</div>;
  const content = view === "books"
    ? directoryShell(<AllBooksDirectoryPage publicBooks={data.books} onBookOpen={authenticate} />)
    : view === "publishing"
      ? directoryShell(<PublicOrganizationDirectoryPage type="Издатель" organizations={data.organizations} onOpen={authenticate} />)
      : view === "communities"
        ? directoryShell(<PublicOrganizationDirectoryPage type="Сообщество" organizations={data.organizations} onOpen={authenticate} />)
        : view === "partners"
          ? directoryShell(<SimpleDirectoryPage kind="partners" />)
          : hubView === "home" ? <GuestHome data={data} authenticate={authenticate} onNavigate={setHubView} /> : <GuestHubDirectory view={hubView} data={data} authenticate={authenticate} />;

  return <div className="app-shell">
    <BookMeetHeader accountName="" accountCaption="" initials="" unreadCount={0} unreadMessages={0} chatsOpen={false} notificationsOpen={false} onHome={() => navigate("home")} onBooks={() => navigate("books")} onPublishing={() => navigate("publishing")} onCommunities={() => navigate("communities")} onPartners={() => navigate("partners")} onNotifications={authenticate} onChats={authenticate} onProfile={authenticate} onLogout={authenticate} guestAction={{ label: "Вход/Регистрация", onClick: authenticate }} />
    <WorkspaceScreen friends={[supportFriend]} selectedId={null} adminMode={false} contentHub={view === "home"} onFindFriends={authenticate} onCreateOccasion={authenticate} onSelectFriend={authenticate} mobileFriendsOpen={false}>
      <ContentHubControls view={(view === "home" ? hubView : view) as MainView} profileType="Читатель" onNavigate={(next) => { if (["home", "events", "reviews", "publications", "occasions"].includes(next)) setHubView(next as GuestHubView); else authenticate(); }} onEvent={authenticate} onReview={authenticate} onPublication={authenticate} onOccasion={authenticate} onPublisherNews={authenticate} />
      {content}
    </WorkspaceScreen>
  </div>;
}
