import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CustomSelect } from "../components/common/CustomSelect";
import { EmptyContentState } from "../components/common/EmptyContentState";
import {
  EventCard,
  EventModal,
  CityFilter,
  deleteReadingMaterial,
  editReadingMaterial,
  HomeScopeSwitch,
  MaterialPreviewCard,
  OccasionCard,
  OccasionModal,
  PublisherNewsCard,
  PublisherNewsModal,
  ReadingModal,
  UnifiedBookModal,
  monthlyBooks,
} from "../components/content/ContentComponents";
import { catalogFromUsers, eventTimestamp } from "../lib/domain";
import { isSpecialLocation, locationMatchesCityFilter } from "../lib/locations";
import type { SocialRelationship } from "../types/domain";
import { openReportDialog } from "../components/safety/SafetyCenter";
import type {
  AuthorBook,
  BookEvent,
  DemoUser,
  Excerpt,
  LibraryBook,
  MaterialComment,
  Occasion,
  PublisherNews,
  PublicCatalogBook,
  ReadingItem,
  Review,
  MaterialActionRef,
} from "../types/domain";
import { useI18n } from "../i18n";

export function HomeContent({ reviews, excerpts, publisherNews, events, occasions, catalog = [], currentUserType, onOpenUser, onCreateEvent, onEditEvent, onCreateOccasion, onEditOccasion, onCreateReview, onCreateExcerpt, onNavigate, currentUserName, currentUser, users, relationshipFor, isFollowing, onAddFriend, onFollow, likes, saves, commentCounts, saveCounts, onToggleLike, onToggleSave, onComment }: { reviews: Review[]; excerpts: Excerpt[]; publisherNews: PublisherNews[]; events: BookEvent[]; occasions: Occasion[]; catalog?: (LibraryBook | AuthorBook)[]; currentUserType: "reader" | "writer" | "blogger"; onOpenUser: (userId: number) => void; onCreateEvent: () => void; onEditEvent: (item: BookEvent) => void; onCreateOccasion: () => void; onEditOccasion: (item: Occasion) => void; onCreateReview: () => void; onCreateExcerpt: () => void; onNavigate: (page: "reviews" | "publications" | "events" | "occasions") => void; currentUserName: string; currentUser: DemoUser; users: DemoUser[]; relationshipFor: (userId: number) => SocialRelationship; isFollowing: (userId: number) => boolean; onAddFriend: (userId: number, message: string) => void; onFollow: (userId: number) => void; likes: Record<string, number[]>; saves: Record<string, number[]>; commentCounts: Record<string, number>; saveCounts: Record<string, number>; onToggleLike: (item: ReadingItem) => void; onToggleSave: (item: ReadingItem) => void; onComment: (item: ReadingItem, text: string) => Promise<MaterialComment | null> }) {
  const { t } = useI18n();
  const [readingItem, setReadingItem] = useState<ReadingItem | null>(null);
  const [openedBlogBook, setOpenedBlogBook] = useState<LibraryBook | AuthorBook | null>(null);
  const [openedEvent, setOpenedEvent] = useState<BookEvent | null>(null);
  const [openedOccasion, setOpenedOccasion] = useState<Occasion | null>(null);
  const [openedPublisherNews, setOpenedPublisherNews] = useState<PublisherNews | null>(null);
  const [feedQuery, setFeedQuery] = useState("");
  const [eventScope, setEventScope] = useState<"country" | "city">("country");
  const [occasionScope, setOccasionScope] = useState<"country" | "city">("country");
  const showMonthlyBooks = false;
  const currentCity = currentUser.profile.city;
  const resolvedCatalog = catalog.length ? catalog : catalogFromUsers(users);
  const normalizeCity = (value: string) => value.trim().toLocaleLowerCase("ru");
  const scopedEvents = events.filter((item) => eventScope === "country"
    ? isSpecialLocation(item.city) || !currentUser.profile.country || item.country?.toLocaleLowerCase("ru") === currentUser.profile.country.toLocaleLowerCase("ru")
    : locationMatchesCityFilter([item.city], currentCity))
    .slice().sort((first, second) => Number(Boolean(second.pinned)) - Number(Boolean(first.pinned)) || eventTimestamp(first) - eventTimestamp(second));
  const scopedOccasions = (occasionScope === "country" || !currentCity ? occasions : occasions.filter((item) => locationMatchesCityFilter(item.targetCities, currentCity))).slice().sort((first, second) => (Date.parse(second.createdAt) || second.id) - (Date.parse(first.createdAt) || first.id));
  const createPublication = () => onCreateExcerpt();
  const homeMode = "feed";
  const feedEntries = [
    ...events.filter((item) => locationMatchesCityFilter([item.city], currentCity)).map((item) => ({ kind: "event" as const, time: Date.parse(item.createdAt) || item.id, item })),
    ...occasions.filter((item) => locationMatchesCityFilter(item.targetCities, currentCity)).map((item) => ({ kind: "occasion" as const, time: Date.parse(item.createdAt) || item.id, item })),
    ...reviews.map((item) => ({ kind: "review" as const, time: Date.parse(item.createdAtValue ?? "") || item.id, item })),
    ...excerpts.map((item) => ({ kind: "excerpt" as const, time: Date.parse(item.createdAtValue ?? "") || item.id, item })),
    ...publisherNews.map((item) => ({ kind: "publisher-news" as const, time: Date.parse(item.createdAtValue ?? "") || item.id, item })),
  ].sort((first, second) => second.time - first.time);
  const feedNeedle = feedQuery.trim().toLocaleLowerCase("ru");
  const visibleFeedEntries = feedEntries.filter((entry) => !feedNeedle || JSON.stringify(entry.item).toLocaleLowerCase("ru").includes(feedNeedle));

  return (
    <main className={`content-scroll home-content home-mode-${homeMode}`}>
      {homeMode === "feed" && <section className="content-section home-feed"><label className="desktop-feed-search"><span aria-hidden="true">⌕</span><input type="search" value={feedQuery} onChange={(event) => setFeedQuery(event.target.value)} placeholder={t("desktop.search.feed")} /></label>{visibleFeedEntries.map((entry, index) => {
        if (entry.kind === "event") { const reading = { id: entry.item.id, kind: "event", title: entry.item.title, author: users.find((user) => user.id === entry.item.creatorId)?.profile.name ?? t("material.user"), text: entry.item.description, preview: entry.item.summary, ownerId: entry.item.creatorId, createdAt: entry.item.createdAt } as ReadingItem; const key = `event-${entry.item.id}`; return <EventCard key={key} item={entry.item} owner={users.find((user) => user.id === entry.item.creatorId)} own={entry.item.creatorId === currentUser.id} likesCount={likes[key]?.length} commentsCount={commentCounts[key]} savesCount={saveCounts[key]} liked={likes[key]?.includes(currentUser.id)} saved={saves[key]?.includes(currentUser.id)} onToggleLike={() => onToggleLike(reading)} onToggleSave={() => onToggleSave(reading)} onOpen={() => setOpenedEvent(entry.item)} onOpenUser={onOpenUser} onEdit={() => onEditEvent(entry.item)} />; }
        if (entry.kind === "occasion") { const reading = { id: entry.item.id, kind: "occasion", title: entry.item.primaryText, author: entry.item.creatorName, text: entry.item.audienceText, preview: entry.item.primaryText, ownerId: entry.item.creatorId, createdAt: entry.item.createdAt } as ReadingItem; const key = `occasion-${entry.item.id}`; return <OccasionCard key={key} item={entry.item} owner={users.find((user) => user.id === entry.item.creatorId)} own={entry.item.creatorId === currentUser.id} likesCount={likes[key]?.length} commentsCount={commentCounts[key]} savesCount={saveCounts[key]} liked={likes[key]?.includes(currentUser.id)} saved={saves[key]?.includes(currentUser.id)} onToggleLike={() => onToggleLike(reading)} onToggleSave={() => onToggleSave(reading)} onOpen={() => setOpenedOccasion(entry.item)} onOpenUser={onOpenUser} onEdit={() => onEditOccasion(entry.item)} />; }
        if (entry.kind === "review") { const review = entry.item; const book = resolvedCatalog.find((item) => item.id === review.linkedBookId) ?? resolvedCatalog.find((item) => item.title.toLowerCase() === review.book.replace(/[«»]/g, "").toLowerCase() && item.author.toLowerCase() === review.author.toLowerCase()); const reading: ReadingItem = { id: review.id, kind: "review", title: review.book, author: review.user, text: review.fullText, bodyHtml: review.bodyHtml, linkedBookId: review.linkedBookId, ownerId: review.ownerId, createdAt: review.createdAt, preview: review.quote, bookAuthor: review.author, rating: Number(review.rating) }; const key = `review-${review.id}`; return <MaterialPreviewCard key={key} item={reading} index={index} owner={users.find((user) => user.id === review.ownerId)} book={book} likesCount={likes[key]?.length} commentsCount={commentCounts[key]} savesCount={saveCounts[key]} liked={likes[key]?.includes(currentUser.id)} saved={saves[key]?.includes(currentUser.id)} onToggleLike={() => onToggleLike(reading)} onToggleSave={() => onToggleSave(reading)} onOpen={() => setReadingItem(reading)} onOpenUser={onOpenUser} onOpenBook={book ? () => setOpenedBlogBook(book) : undefined} />; }
        if (entry.kind === "publisher-news") return <PublisherNewsCard key={`publisher-news-${entry.item.id}`} item={entry.item} owner={users.find((user) => user.id === entry.item.ownerId)} onOpen={() => setOpenedPublisherNews(entry.item)} onOpenUser={onOpenUser} />;
        const excerpt = entry.item; const book = excerpt.linkedBookId ? resolvedCatalog.find((item) => item.id === excerpt.linkedBookId) : undefined; const reading: ReadingItem = { id: excerpt.id, kind: "excerpt", title: book?.title || t("content.publications"), author: excerpt.author, text: excerpt.fullText, preview: excerpt.text, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.linkedBookId, linkedBookIds: excerpt.linkedBookIds, ownerId: excerpt.ownerId, createdAt: excerpt.createdAt }; const key = `excerpt-${excerpt.id}`; return <MaterialPreviewCard key={key} item={reading} index={index} owner={users.find((user) => user.id === excerpt.ownerId)} book={book} likesCount={likes[key]?.length} commentsCount={commentCounts[key]} savesCount={saveCounts[key]} liked={likes[key]?.includes(currentUser.id)} saved={saves[key]?.includes(currentUser.id)} onToggleLike={() => onToggleLike(reading)} onToggleSave={() => onToggleSave(reading)} onOpen={() => setReadingItem(reading)} onOpenUser={onOpenUser} onOpenBook={book ? () => setOpenedBlogBook(book) : undefined} />;
      })}{!visibleFeedEntries.length && <EmptyContentState />}</section>}
      <section className="content-section events-section"><div className="section-heading"><div className="interactive-section-title"><button className="home-section-link" type="button" onClick={() => onNavigate("events")}>{t("content.bookEvents")}</button><HomeScopeSwitch city={currentCity} country={currentUser.profile.country} value={eventScope} onChange={setEventScope} /></div></div>{scopedEvents.length ? <div className="events-grid">{scopedEvents.slice(0, 2).map((item) => <EventCard key={item.id} item={item} own={item.creatorId === currentUser.id} onOpen={() => setOpenedEvent(item)} onOpenBook={item.linkedBookId ? () => setOpenedBlogBook(resolvedCatalog.find((book) => book.id === item.linkedBookId) ?? null) : undefined} onEdit={() => onEditEvent(item)} />)}</div> : <EmptyContentState />}</section>

      <section className="content-section">
        <div className="section-heading">
          <button className="home-section-link" type="button" onClick={() => onNavigate("reviews")}>{t("content.reviews")}</button>
        </div>
        {reviews.length > 0 ? (
          <div className="excerpt-grid review-material-grid">
            {reviews.map((review, index) => { const reviewBook = resolvedCatalog.find((book) => book.id === review.linkedBookId) ?? resolvedCatalog.find((book) => book.title.toLowerCase() === review.book.replace(/[«»]/g, "").toLowerCase() && book.author.toLowerCase() === review.author.toLowerCase()); const item: ReadingItem = { id: review.id, kind: "review", title: review.book, author: review.user, text: review.fullText, bodyHtml: review.bodyHtml, linkedBookId: review.linkedBookId, ownerId: review.ownerId, createdAt: review.createdAt, preview: review.quote, bookAuthor: review.author, rating: Number(review.rating) }; return <MaterialPreviewCard key={`${review.ownerId}-${review.id}`} item={item} index={index} owner={users.find((user) => user.id === review.ownerId)} book={reviewBook} onOpen={() => setReadingItem(item)} onOpenUser={onOpenUser} onOpenBook={reviewBook ? () => setOpenedBlogBook(reviewBook) : undefined} />; })}
          </div>
        ) : (
          <EmptyContentState action={t("directory.firstReview")} onAction={onCreateReview} />
        )}
      </section>

      <section className="content-section">
        <div className="section-heading">
          <button className="home-section-link" type="button" onClick={() => onNavigate("publications")}>{t("content.blogPublications")}</button>
        </div>
        {excerpts.length > 0 ? (
          <div className="excerpt-grid">
            {excerpts.map((excerpt, index) => {
              const linkedBook = excerpt.linkedBookId ? resolvedCatalog.find((book) => book.id === excerpt.linkedBookId) : undefined;
              return (
            <MaterialPreviewCard key={`${excerpt.ownerId}-${excerpt.id}`} item={{ id: excerpt.id, kind: "excerpt", title: linkedBook?.title || t("content.publications"), author: excerpt.author, text: excerpt.fullText, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.linkedBookId, linkedBookIds: excerpt.linkedBookIds, ownerId: excerpt.ownerId, createdAt: excerpt.createdAt, preview: excerpt.text }} index={index} owner={users.find((user) => user.id === excerpt.ownerId)} book={linkedBook} onOpen={() => setReadingItem({ id: excerpt.id, kind: "excerpt", title: linkedBook?.title || t("content.publications"), author: excerpt.author, text: excerpt.fullText, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.linkedBookId, linkedBookIds: excerpt.linkedBookIds, ownerId: excerpt.ownerId, createdAt: excerpt.createdAt, preview: excerpt.text })} onOpenUser={onOpenUser} onOpenBook={linkedBook ? () => setOpenedBlogBook(linkedBook) : undefined} />
              );
            })}
          </div>
        ) : (
          <EmptyContentState action={t("directory.firstPublication")} onAction={onCreateExcerpt} />
        )}
      </section>
      {openedBlogBook && <UnifiedBookModal book={openedBlogBook} users={users} catalog={resolvedCatalog} onClose={() => setOpenedBlogBook(null)} onOpenUser={onOpenUser} onReport={!currentUser.isAdmin && !currentUser.books.some((book) => book.id === openedBlogBook.id) && !(currentUser.authorBooks ?? []).some((book) => book.id === openedBlogBook.id) ? () => openReportDialog({ kind: "book", id: openedBlogBook.id }) : undefined} />}
      {openedEvent && <EventModal item={openedEvent} users={users} catalog={resolvedCatalog} currentUserId={currentUser.id} currentUser={currentUser} onOpenUser={onOpenUser} onOpenBook={openedEvent.linkedBookId ? () => {
        setOpenedBlogBook(resolvedCatalog.find((book) => book.id === openedEvent.linkedBookId) ?? null);
        setOpenedEvent(null);
      } : undefined} onClose={() => setOpenedEvent(null)} onEdit={openedEvent.creatorId === currentUser.id ? () => { onEditEvent(openedEvent); setOpenedEvent(null); } : undefined} onDelete={openedEvent.creatorId === currentUser.id ? async () => { if (!window.confirm(t("event.deleteConfirm", { title: openedEvent.title }))) return; const response = await fetch(`/api/events/${openedEvent.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert(t("event.deleteError")); return; } window.location.reload(); } : undefined} onReport={!currentUser.isAdmin && openedEvent.creatorId !== currentUser.id ? () => openReportDialog({ kind: "event", id: openedEvent.id }) : undefined} />}

      {showMonthlyBooks && (
        <section className="content-section monthly-section">
          <div className="section-heading"><h2>{t("content.editorsChoice")}</h2></div>
          <div className="book-grid">
            {monthlyBooks.map((book, index) => (
              <article className="book-card" key={book.title}>
                <div className={`book-cover ${book.cover}`}><span className="book-number">0{index + 1}</span><strong>{book.mark}</strong><i>Book Meet</i></div>
                <h3>{book.title}</h3><p>{book.author}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="content-section occasions-section">
        <div className="section-heading"><div className="interactive-section-title"><button className="home-section-link" type="button" onClick={() => onNavigate("occasions")}>{t("content.occasions")}</button><HomeScopeSwitch city={currentCity} country={currentUser.profile.country} value={occasionScope} onChange={setOccasionScope} /></div></div>
        {scopedOccasions.length ? <div className="occasion-grid home-occasion-grid">{scopedOccasions.slice(0, 2).map((item) => <OccasionCard key={item.id} item={item} own={item.creatorId === currentUser.id} onOpen={() => setOpenedOccasion(item)} onEdit={() => onEditOccasion(item)} />)}</div> : <EmptyContentState action={t("directory.firstOccasion")} onAction={onCreateOccasion} />}
      </section>

      {readingItem && <ReadingModal item={readingItem} currentUser={currentUser} users={users} catalog={resolvedCatalog} likedUserIds={likes[`${readingItem.kind}-${readingItem.id}`] ?? []} onToggleLike={() => onToggleLike(readingItem)} onComment={(text) => onComment(readingItem, text)} onClose={() => setReadingItem(null)} onOpenUser={onOpenUser} relationship={readingItem.ownerId ? relationshipFor(readingItem.ownerId) : undefined} isFollowing={readingItem.ownerId ? isFollowing(readingItem.ownerId) : false} onAddFriend={readingItem.ownerId ? (message) => onAddFriend(readingItem.ownerId!, message) : undefined} onFollow={readingItem.ownerId ? () => onFollow(readingItem.ownerId!) : undefined} onEdit={currentUser.isAdmin || readingItem.ownerId === currentUser.id ? () => void editReadingMaterial(readingItem, currentUser) : undefined} onDelete={currentUser.isAdmin || readingItem.ownerId === currentUser.id ? () => void deleteReadingMaterial(readingItem, currentUser) : undefined} onReport={!currentUser.isAdmin && readingItem.ownerId !== currentUser.id ? () => openReportDialog({ kind: readingItem.kind, id: readingItem.id }) : undefined} />}
      {openedOccasion && <OccasionModal item={openedOccasion} currentUser={currentUser} users={users} onOpenUser={onOpenUser} onOpenBook={(bookId) => { setOpenedBlogBook(resolvedCatalog.find((book) => book.id === bookId) ?? null); setOpenedOccasion(null); }} onClose={() => setOpenedOccasion(null)} onEdit={openedOccasion.creatorId === currentUser.id ? () => { onEditOccasion(openedOccasion); setOpenedOccasion(null); } : undefined} onDelete={openedOccasion.creatorId === currentUser.id ? async () => { if (!window.confirm(t("occasion.deleteConfirm"))) return; const response = await fetch(`/api/occasions/${openedOccasion.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert(t("occasion.deleteError")); return; } window.location.reload(); } : undefined} onReport={!currentUser.isAdmin && openedOccasion.creatorId !== currentUser.id ? () => openReportDialog({ kind: "occasion", id: openedOccasion.id }) : undefined} />}
      {openedPublisherNews && <PublisherNewsModal item={openedPublisherNews} owner={users.find((user) => user.id === openedPublisherNews.ownerId)} currentUser={currentUser} users={users} catalog={resolvedCatalog} onClose={() => setOpenedPublisherNews(null)} onOpenUser={onOpenUser} onReport={!currentUser.isAdmin ? () => openReportDialog({ kind: "publisher_news", id: openedPublisherNews.id }) : undefined} />}
    </main>
  );
}

export function EventsDirectoryPage({ events, currentUser, users, catalog = [], onHome, onCreate, onEdit, onOpenUser }: { events: BookEvent[]; currentUser: DemoUser; users: DemoUser[]; catalog?: (LibraryBook | AuthorBook)[]; onHome: () => void; onCreate: () => void; onEdit: (item: BookEvent) => void; onOpenUser: (userId: number) => void }) {
  const { t, formatNumber } = useI18n();
  const [city, setCity] = useState(currentUser.profile.city);
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<BookEvent | null>(null);
  const [openedBook, setOpenedBook] = useState<LibraryBook | AuthorBook | null>(null);
  const resolvedCatalog = catalog.length ? catalog : catalogFromUsers(users);
  const needle = query.trim().toLocaleLowerCase("ru");
  const visible = events.filter((item) => item.status === "published" || item.creatorId === currentUser.id).filter((item) => locationMatchesCityFilter([item.city], city)).filter((item) => !needle || `${item.title} ${item.summary} ${item.creatorName} ${item.bookTitle ?? ""} ${item.bookAuthor ?? ""}`.toLocaleLowerCase("ru").includes(needle)).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || eventTimestamp(a) - eventTimestamp(b));
  const openBook = (item: BookEvent) => setOpenedBook(resolvedCatalog.find((book) => book.id === item.linkedBookId) ?? null);
  return <main className="content-scroll directory-page"><button className="back-button directory-home-button" type="button" onClick={onHome}>← {t("common.home")}</button><div className="directory-heading"><div><span className="section-subtitle">{t("event.poster")}</span><h1>{t("content.bookEvents")}</h1><p>{t("event.selectedCityCount", { count: formatNumber(visible.length) })}</p></div><div className="directory-controls"><label className="desktop-directory-search"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("desktop.search.feed")} aria-label={t("desktop.search.feed")} /></label><CityFilter value={city} cities={events.filter((item) => item.status === "published" || item.creatorId === currentUser.id).map((item) => item.city)} onChange={setCity} /><button className="primary-button creation-action-button" type="button" onClick={onCreate}>{t("content.createEvent")}</button></div></div>{visible.length ? <div className="events-grid">{visible.map((item) => <EventCard key={item.id} item={item} own={item.creatorId === currentUser.id} owner={users.find((user) => user.id === item.creatorId)} onOpen={() => setOpened(item)} onOpenUser={onOpenUser} onOpenBook={item.linkedBookId ? () => openBook(item) : undefined} onEdit={() => onEdit(item)} />)}</div> : <EmptyContentState action={t("content.createEvent")} onAction={onCreate} />}{opened && <EventModal item={opened} users={users} currentUserId={currentUser.id} currentUser={currentUser} onOpenUser={onOpenUser} onOpenBook={opened.linkedBookId ? () => openBook(opened) : undefined} onClose={() => setOpened(null)} onEdit={opened.creatorId === currentUser.id ? () => { onEdit(opened); setOpened(null); } : undefined} onDelete={opened.creatorId === currentUser.id ? async () => { if (!window.confirm(t("event.deleteConfirm", { title: opened.title }))) return; const response = await fetch(`/api/events/${opened.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert(t("event.deleteError")); return; } window.location.reload(); } : undefined} onReport={!currentUser.isAdmin && opened.creatorId !== currentUser.id ? () => openReportDialog({ kind: "event", id: opened.id }) : undefined} />}{openedBook && <UnifiedBookModal book={openedBook} users={users} onClose={() => setOpenedBook(null)} onReport={!currentUser.isAdmin && !currentUser.books.some((book) => book.id === openedBook.id) && !(currentUser.authorBooks ?? []).some((book) => book.id === openedBook.id) ? () => openReportDialog({ kind: "book", id: openedBook.id }) : undefined} />}</main>;
}

export function OccasionsDirectoryPage({ occasions, currentUser, users, catalog = [], onHome, onCreate, onEdit, onOpenUser }: { occasions: Occasion[]; currentUser: DemoUser; users: DemoUser[]; catalog?: (LibraryBook | AuthorBook)[]; onHome: () => void; onCreate: () => void; onEdit: (item: Occasion) => void; onOpenUser: (id: number) => void }) {
  const { t, formatNumber } = useI18n();
  const [city, setCity] = useState(currentUser.profile.city);
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<Occasion | null>(null);
  const [openedBook, setOpenedBook] = useState<LibraryBook | AuthorBook | null>(null);
  const resolvedCatalog = catalog.length ? catalog : catalogFromUsers(users);
  const needle = query.trim().toLocaleLowerCase("ru");
  const visible = occasions.filter((item) => item.status === "published" || item.creatorId === currentUser.id).filter((item) => locationMatchesCityFilter(item.targetCities, city)).filter((item) => item.creatorId === currentUser.id || (item.targetGender === "Все" || item.targetGender === currentUser.profile.gender) && (item.targetProfileType === "Все" || item.targetProfileType === currentUser.profile.type)).filter((item) => !needle || `${item.primaryText} ${item.audienceText} ${item.creatorName} ${item.targetCities.join(" ")}`.toLocaleLowerCase("ru").includes(needle));
  const eligible = occasions.filter((item) => item.creatorId === currentUser.id || (item.targetGender === "Все" || item.targetGender === currentUser.profile.gender) && (item.targetProfileType === "Все" || item.targetProfileType === currentUser.profile.type));
  return <main className="content-scroll directory-page"><button className="back-button directory-home-button" type="button" onClick={onHome}>← {t("common.home")}</button><div className="directory-heading"><div><span className="section-subtitle">{t("occasion.interestMeetups")}</span><h1>{t("content.occasions")}</h1><p>{t("occasion.suitableCount", { count: formatNumber(visible.length) })}</p></div><div className="directory-controls"><label className="desktop-directory-search"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("desktop.search.feed")} aria-label={t("desktop.search.feed")} /></label><CityFilter value={city} cities={eligible.flatMap((item) => item.targetCities)} onChange={setCity} /><button className="primary-button creation-action-button" type="button" onClick={onCreate}>{t("content.createOccasion")}</button></div></div>{visible.length ? <div className="occasion-grid">{visible.map((item) => <OccasionCard key={item.id} item={item} own={item.creatorId === currentUser.id} owner={users.find((user) => user.id === item.creatorId)} onOpen={() => setOpened(item)} onOpenUser={onOpenUser} onEdit={() => onEdit(item)} />)}</div> : <EmptyContentState />}{opened && <OccasionModal item={opened} currentUser={currentUser} users={users} onOpenUser={onOpenUser} onOpenBook={(bookId) => { setOpenedBook(resolvedCatalog.find((book) => book.id === bookId) ?? null); setOpened(null); }} onClose={() => setOpened(null)} onEdit={opened.creatorId === currentUser.id ? () => { onEdit(opened); setOpened(null); } : undefined} onDelete={opened.creatorId === currentUser.id ? async () => { if (!window.confirm(t("occasion.deleteConfirm"))) return; const response = await fetch(`/api/occasions/${opened.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert(t("occasion.deleteError")); return; } window.location.reload(); } : undefined} onReport={!currentUser.isAdmin && opened.creatorId !== currentUser.id ? () => openReportDialog({ kind: "occasion", id: opened.id }) : undefined} />}{openedBook && <UnifiedBookModal book={openedBook} users={users} catalog={resolvedCatalog} onOpenUser={onOpenUser} onClose={() => setOpenedBook(null)} />}</main>;
}

export function MaterialsDirectoryPage({ kind, reviews, excerpts, publisherNews = [], currentUser, users, catalog = [], likes, saves, commenters, commentCounts, saveCounts, onCreate, onToggleLike, onToggleSave, onComment, onOpenUser, relationshipFor, isFollowing, onAddFriend, onFollow }: { kind: "review" | "excerpt"; reviews: Review[]; excerpts: Excerpt[]; publisherNews?: PublisherNews[]; currentUser: DemoUser; users: DemoUser[]; catalog?: (LibraryBook | AuthorBook)[]; likes: Record<string, number[]>; saves: Record<string, number[]>; commenters: Record<string, number[]>; commentCounts: Record<string, number>; saveCounts: Record<string, number>; onCreate: () => void; onToggleLike: (item: ReadingItem) => void; onToggleSave: (item: ReadingItem) => void; onComment: (item: ReadingItem, text: string) => Promise<MaterialComment | null>; onOpenUser: (userId: number) => void; relationshipFor: (userId: number) => SocialRelationship; isFollowing: (userId: number) => boolean; onAddFriend: (userId: number, message: string) => void; onFollow: (userId: number) => void }) {
  const { t, formatNumber } = useI18n();
  const [sort, setSort] = useState<"created" | "popular">("created");
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<ReadingItem | null>(null);
  const [openedBook, setOpenedBook] = useState<LibraryBook | AuthorBook | null>(null);
  const [openedPublisherNews, setOpenedPublisherNews] = useState<PublisherNews | null>(null);
  const resolvedCatalog = catalog.length ? catalog : catalogFromUsers(users);
  const materials = kind === "review" ? reviews : excerpts;
  const popularity = (id: number) => (likes[`${kind}-${id}`]?.length ?? 0) + (commenters[`${kind}-${id}`]?.length ?? 0);
  const needle = query.trim().toLocaleLowerCase("ru");
  const sorted = useMemo(() => [...materials].filter((item) => !needle || JSON.stringify(item).toLocaleLowerCase("ru").includes(needle)).sort((first, second) => sort === "popular" ? popularity(second.id) - popularity(first.id) || second.id - first.id : (Date.parse(second.createdAtValue ?? "") || second.id) - (Date.parse(first.createdAtValue ?? "") || first.id)), [materials, needle, sort, likes, commenters]);
  const sortedPublisherNews = useMemo(() => [...publisherNews].filter((item) => !needle || JSON.stringify(item).toLocaleLowerCase("ru").includes(needle)).sort((first, second) => (Date.parse(second.createdAtValue ?? "") || second.id) - (Date.parse(first.createdAtValue ?? "") || first.id)), [publisherNews, needle]);
  const heading = kind === "review" ? t("content.reviews") : t("content.publications");
  return <main className="content-scroll directory-page">
    <div className="directory-heading"><div><span className="section-subtitle">{t("directory.allCommunityMaterials")}</span><h1>{heading}</h1><p>{t("directory.materialCount", { count: formatNumber(sorted.length + (kind === "excerpt" ? sortedPublisherNews.length : 0)) })}</p></div><div className="directory-controls materials-directory-controls"><label className="desktop-directory-search directory-material-search"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("desktop.search.feed")} aria-label={t("desktop.search.feed")} /></label><label className="directory-control-field"><span>{t("common.sort")}</span><CustomSelect ariaLabel={t("common.sort")} value={sort} onChange={setSort} options={[{ value: "created", label: t("directory.dateCreated") }, { value: "popular", label: t("directory.popular") }]} /></label><button className="primary-button creation-action-button" type="button" onClick={onCreate}>{kind === "review" ? t("content.createReview") : t("content.createPublication")}</button></div></div>
    <div className="excerpt-grid directory-material-grid">
      {kind === "review" ? (sorted as Review[]).map((review, index) => { const matchingBook = resolvedCatalog.find((book) => book.id === review.linkedBookId) ?? resolvedCatalog.find((book) => book.title.toLowerCase() === review.book.replace(/[«»]/g, "").toLowerCase() && book.author.toLowerCase() === review.author.toLowerCase()); const item: ReadingItem = { id: review.id, kind: "review", title: review.book, author: review.user, text: review.fullText, bodyHtml: review.bodyHtml, linkedBookId: review.linkedBookId, ownerId: review.ownerId, createdAt: review.createdAt, preview: review.quote, bookAuthor: review.author, rating: Number(review.rating) }; return <MaterialPreviewCard key={`${review.ownerId}-${review.id}`} item={item} index={index} owner={users.find((user) => user.id === review.ownerId)} book={matchingBook} likesCount={likes[`review-${review.id}`]?.length ?? 0} commentsCount={commenters[`review-${review.id}`]?.length ?? 0} onOpen={() => setOpened(item)} onOpenUser={onOpenUser} onOpenBook={matchingBook ? () => setOpenedBook(matchingBook) : undefined} />; }) : <>{(sorted as Excerpt[]).map((excerpt, index) => { const linkedBook = excerpt.linkedBookId ? resolvedCatalog.find((book) => book.id === excerpt.linkedBookId) : undefined; const item: ReadingItem = { id: excerpt.id, kind: "excerpt", title: linkedBook?.title || t("content.publications"), author: excerpt.author, text: excerpt.fullText, preview: excerpt.text, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.linkedBookId, ownerId: excerpt.ownerId, createdAt: excerpt.createdAt }; return <MaterialPreviewCard key={`${excerpt.ownerId}-${excerpt.id}`} item={item} index={index} owner={users.find((user) => user.id === excerpt.ownerId)} book={linkedBook} likesCount={likes[`excerpt-${excerpt.id}`]?.length ?? 0} commentsCount={commenters[`excerpt-${excerpt.id}`]?.length ?? 0} onOpen={() => setOpened(item)} onOpenUser={onOpenUser} onOpenBook={linkedBook ? () => setOpenedBook(linkedBook) : undefined} />; })}{sortedPublisherNews.map((item) => <PublisherNewsCard key={`publisher-news-${item.id}`} item={item} owner={users.find((user) => user.id === item.ownerId)} onOpen={() => setOpenedPublisherNews(item)} onOpenUser={onOpenUser} />)}</>}
    </div>
    {!sorted.length && (kind === "review" || !sortedPublisherNews.length) && <EmptyContentState />}
    {opened && <ReadingModal item={opened} currentUser={currentUser} users={users} likedUserIds={likes[`${opened.kind}-${opened.id}`] ?? []} onToggleLike={() => onToggleLike(opened)} onComment={(text) => onComment(opened, text)} onOpenUser={onOpenUser} onClose={() => setOpened(null)} relationship={opened.ownerId ? relationshipFor(opened.ownerId) : "none"} isFollowing={opened.ownerId ? isFollowing(opened.ownerId) : false} onAddFriend={(message) => opened.ownerId && onAddFriend(opened.ownerId, message)} onFollow={() => opened.ownerId && onFollow(opened.ownerId)} onReport={!currentUser.isAdmin && opened.ownerId !== currentUser.id ? () => openReportDialog({ kind: opened.kind, id: opened.id }) : undefined} />}
    {openedPublisherNews && <PublisherNewsModal item={openedPublisherNews} owner={users.find((user) => user.id === openedPublisherNews.ownerId)} currentUser={currentUser} users={users} catalog={resolvedCatalog} onClose={() => setOpenedPublisherNews(null)} onOpenUser={onOpenUser} onReport={!currentUser.isAdmin ? () => openReportDialog({ kind: "publisher_news", id: openedPublisherNews.id }) : undefined} />}
    {openedBook && <UnifiedBookModal book={openedBook} users={users} onClose={() => setOpenedBook(null)} onReport={!currentUser.isAdmin && !currentUser.books.some((book) => book.id === openedBook.id) && !(currentUser.authorBooks ?? []).some((book) => book.id === openedBook.id) ? () => openReportDialog({ kind: "book", id: openedBook.id }) : undefined} />}
  </main>;
}

type CatalogDirectoryBook = LibraryBook & { addedAt: string; popularity: number };

function catalogDirectoryBook(book: Partial<CatalogDirectoryBook> & Pick<CatalogDirectoryBook, "id" | "author" | "title" | "popularity">): CatalogDirectoryBook {
  return { genres: [], annotation: "", pages: "", format: "Бумажная", durationHours: "", durationMinutes: "", rating: 0, review: "", coverTone: "blue", addedAt: "", ...book } as CatalogDirectoryBook;
}

export function AllBooksDirectoryPage({ users = [], currentUser, onOpenUser = () => undefined, publicBooks, onBookOpen }: { users?: DemoUser[]; currentUser?: DemoUser; onOpenUser?: (id: number) => void; publicBooks?: PublicCatalogBook[]; onBookOpen?: (book: PublicCatalogBook) => void }) {
  const { t } = useI18n();
  const [books, setBooks] = useState<CatalogDirectoryBook[]>(() => (publicBooks ?? []).map(catalogDirectoryBook));
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"alphabetical" | "added" | "popular">("alphabetical");
  const [opened, setOpened] = useState<CatalogDirectoryBook | null>(null);
  const [loading, setLoading] = useState(!publicBooks);
  useEffect(() => {
    if (publicBooks) { setBooks(publicBooks.map(catalogDirectoryBook)); setLoading(false); return; }
    let active = true;
    fetch("/api/books/catalog", { credentials: "same-origin", cache: "no-store" }).then((response) => response.json()).then((data: { books?: Array<Partial<CatalogDirectoryBook> & Pick<CatalogDirectoryBook, "id" | "author" | "title" | "addedAt" | "popularity">> }) => { if (!active) return; setBooks((data.books ?? []).map(catalogDirectoryBook)); }).catch(console.warn).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [publicBooks]);
  const visible = useMemo(() => { const needle = query.trim().toLocaleLowerCase("ru"); return books.filter((book) => !needle || `${book.title} ${book.author}`.toLocaleLowerCase("ru").includes(needle)).sort((first, second) => sort === "added" ? Date.parse(second.addedAt) - Date.parse(first.addedAt) || first.title.localeCompare(second.title, "ru") : sort === "popular" ? second.popularity - first.popularity || first.title.localeCompare(second.title, "ru") : first.title.localeCompare(second.title, "ru") || first.author.localeCompare(second.author, "ru")); }, [books, query, sort]);
  const openBook = (book: CatalogDirectoryBook) => onBookOpen ? onBookOpen(book) : setOpened(book);
  return <main className="content-scroll directory-page books-directory-page"><div className="directory-heading"><div><h1>{t("nav.books")}</h1><p>{t("directory.booksCount", { count: visible.length })}</p></div><div className="directory-controls books-directory-controls"><label className="books-search-field"><span>{t("directory.searchBooks")}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("content.bookTitleAuthor")} /></label><label className="directory-control-field"><span>{t("common.sort")}</span><CustomSelect ariaLabel={t("directory.sortBooks")} value={sort} onChange={setSort} options={[{ value: "alphabetical", label: t("directory.alphabetical") }, { value: "added", label: t("directory.dateAdded") }, { value: "popular", label: t("directory.popular") }]} /></label></div></div>{loading ? <p className="directory-loading">{t("directory.loadingBooks")}</p> : visible.length ? <div className="all-books-grid">{visible.map((book) => <article className="library-book material-clickable-card" role="button" tabIndex={0} key={book.id} onClick={() => openBook(book)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openBook(book); } }}><div className="all-books-cover-frame"><div className={`library-book-cover library-cover-${book.coverTone}`} data-i18n-skip style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div></div><div className="library-book-copy"><h3 data-i18n-skip>{book.title}</h3><p data-i18n-skip>{book.author}</p><small>{t("directory.inLibraries", { count: book.popularity })}</small></div></article>)}</div> : <EmptyContentState />}{opened && currentUser && <UnifiedBookModal book={opened} users={users} onOpenUser={onOpenUser} onClose={() => setOpened(null)} onReport={!currentUser.isAdmin && opened.creatorUserId !== currentUser.id ? () => openReportDialog({ kind: "book", id: opened.id }) : undefined} />}</main>;
}

export function SimpleDirectoryPage({ kind }: { kind: "communities" | "partners" }) {
  const { t } = useI18n();
  const communities = kind === "communities";
  return <main className="content-scroll directory-page simple-directory-page"><div className="directory-heading"><div><h1>{communities ? t("nav.communities") : t("nav.partners")}</h1><p>{communities ? t("directory.communityPlace") : t("directory.partnersIntro")}</p></div></div><EmptyContentState /></main>;
}

export function PersonalMaterialFeed({ mode, refs, users, events, occasions, publisherNews, currentUser, likes, saves, commentCounts, saveCounts, onToggleLike, onToggleSave, onOpenUser, onOpenMaterial }: { mode: "liked" | "saved"; refs: MaterialActionRef[]; users: DemoUser[]; events: BookEvent[]; occasions: Occasion[]; publisherNews: PublisherNews[]; currentUser: DemoUser; likes: Record<string, number[]>; saves: Record<string, number[]>; commentCounts: Record<string, number>; saveCounts: Record<string, number>; onToggleLike: (item: ReadingItem) => void; onToggleSave: (item: ReadingItem) => void; onOpenUser: (id: number) => void; onOpenMaterial: (kind: MaterialActionRef["kind"], id: number) => void }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(12);
  const sentinel = useRef<HTMLDivElement>(null);
  const entries: Array<{ key: string; createdAt: string; node: ReactNode }> = [];
  const actionProps = (item: ReadingItem) => { const key = `${item.kind}-${item.id}`; return { likesCount: likes[key]?.length ?? 0, commentsCount: commentCounts[key] ?? 0, savesCount: saveCounts[key] ?? 0, liked: Boolean(likes[key]?.includes(currentUser.id)), saved: Boolean(saves[key]?.includes(currentUser.id)), onToggleLike: () => onToggleLike(item), onToggleSave: () => onToggleSave(item), onOpenComments: () => onOpenMaterial(item.kind, item.id) }; };
  for (const ref of refs) {
    if (ref.kind === "event") { const source = events.find((entry) => entry.id === ref.id); if (source) { const item: ReadingItem = { id: source.id, kind: "event", title: source.title, author: users.find((user) => user.id === source.creatorId)?.profile.name ?? t("material.user"), text: source.description, preview: source.summary, ownerId: source.creatorId, createdAt: source.createdAt }; entries.push({ key: `event-${source.id}`, createdAt: ref.createdAt, node: <EventCard item={source} own={source.creatorId === currentUser.id} {...actionProps(item)} onOpen={() => onOpenMaterial("event", source.id)} /> }); } continue; }
    if (ref.kind === "occasion") { const source = occasions.find((entry) => entry.id === ref.id); if (source) { const item: ReadingItem = { id: source.id, kind: "occasion", title: source.primaryText, author: source.creatorName, text: source.audienceText, preview: source.primaryText, ownerId: source.creatorId, createdAt: source.createdAt }; entries.push({ key: `occasion-${source.id}`, createdAt: ref.createdAt, node: <OccasionCard item={source} own={source.creatorId === currentUser.id} {...actionProps(item)} onOpen={() => onOpenMaterial("occasion", source.id)} /> }); } continue; }
    if (ref.kind === "publisher_news") { const source = publisherNews.find((entry) => entry.id === ref.id); if (source) { const owner = users.find((user) => user.id === source.ownerId); const item: ReadingItem = { id: source.id, kind: "publisher_news", title: source.title, author: owner?.profile.name ?? "Book Meet", text: source.body, preview: source.previewText, ownerId: source.ownerId, createdAt: source.createdAt }; entries.push({ key: `publisher_news-${source.id}`, createdAt: ref.createdAt, node: <PublisherNewsCard item={source} owner={owner} {...actionProps(item)} onOpen={() => onOpenMaterial("publisher_news", source.id)} onOpenUser={onOpenUser} /> }); } continue; }
    const owner = users.find((user) => ref.kind === "review" ? user.reviews.some((entry) => entry.id === ref.id) : (user.excerpts ?? []).some((entry) => entry.id === ref.id));
    if (!owner) continue;
    const item: ReadingItem | null = ref.kind === "review" ? (() => { const source = owner.reviews.find((entry) => entry.id === ref.id); return source ? { id: source.id, kind: "review", title: source.bookTitle, author: owner.profile.name, text: source.fullText, preview: source.preview, bodyHtml: source.bodyHtml, ownerId: owner.id, createdAt: source.createdAt, bookAuthor: source.bookAuthor, rating: source.rating } : null; })() : (() => { const source = owner.excerpts?.find((entry) => entry.id === ref.id); return source ? { id: source.id, kind: "excerpt", title: source.bookTitle || t("content.publications"), author: owner.profile.name, text: source.text, preview: source.previewText, bodyHtml: source.bodyHtml, ownerId: owner.id, createdAt: source.createdAt, linkedBookId: source.bookId } : null; })();
    if (item) entries.push({ key: `${item.kind}-${item.id}`, createdAt: ref.createdAt, node: <MaterialPreviewCard item={item} index={entries.length} owner={owner} {...actionProps(item)} onOpen={() => onOpenMaterial(item.kind, item.id)} onOpenUser={onOpenUser} /> });
  }
  entries.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  useEffect(() => { setShown(12); }, [mode]);
  useEffect(() => { const node = sentinel.current; if (!node || shown >= entries.length || !("IntersectionObserver" in window)) return; const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setShown((count) => Math.min(entries.length, count + 12)); }); observer.observe(node); return () => observer.disconnect(); }, [shown, entries.length]);
  return <main className="content-scroll directory-page personal-material-feed"><div className="directory-heading"><h1>{mode === "liked" ? t("feed.liked") : t("feed.saved")}</h1></div>{entries.slice(0, shown).map((entry) => <div key={entry.key}>{entry.node}</div>)}{!entries.length && <><EmptyContentState /><p className="personal-material-empty-copy">{mode === "liked" ? t("feed.emptyLiked") : t("feed.emptySaved")}</p></>}{shown < entries.length && <><div ref={sentinel} /><button className="outline-button" type="button" onClick={() => setShown((count) => Math.min(entries.length, count + 12))}>{t("feed.loadMore")}</button></>}{entries.length > 0 && shown >= entries.length && <p className="feed-end">{t("feed.end")}</p>}</main>;
}
