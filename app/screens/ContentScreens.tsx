import { useEffect, useMemo, useState } from "react";
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
  ReadingItem,
  Review,
} from "../types/domain";

export function HomeContent({ reviews, excerpts, publisherNews, events, occasions, currentUserType, onOpenUser, onCreateEvent, onEditEvent, onCreateOccasion, onEditOccasion, onCreateReview, onCreateExcerpt, onNavigate, currentUserName, currentUser, users, relationshipFor, isFollowing, onAddFriend, onFollow, likes, onToggleLike, onComment }: { reviews: Review[]; excerpts: Excerpt[]; publisherNews: PublisherNews[]; events: BookEvent[]; occasions: Occasion[]; currentUserType: "reader" | "writer" | "blogger"; onOpenUser: (userId: number) => void; onCreateEvent: () => void; onEditEvent: (item: BookEvent) => void; onCreateOccasion: () => void; onEditOccasion: (item: Occasion) => void; onCreateReview: () => void; onCreateExcerpt: () => void; onNavigate: (page: "reviews" | "publications" | "events" | "occasions") => void; currentUserName: string; currentUser: DemoUser; users: DemoUser[]; relationshipFor: (userId: number) => SocialRelationship; isFollowing: (userId: number) => boolean; onAddFriend: (userId: number, message: string) => void; onFollow: (userId: number) => void; likes: Record<string, number[]>; onToggleLike: (item: ReadingItem) => void; onComment: (item: ReadingItem, text: string) => Promise<MaterialComment | null> }) {
  const [readingItem, setReadingItem] = useState<ReadingItem | null>(null);
  const [openedBlogBook, setOpenedBlogBook] = useState<LibraryBook | AuthorBook | null>(null);
  const [openedEvent, setOpenedEvent] = useState<BookEvent | null>(null);
  const [openedOccasion, setOpenedOccasion] = useState<Occasion | null>(null);
  const [openedPublisherNews, setOpenedPublisherNews] = useState<PublisherNews | null>(null);
  const [eventScope, setEventScope] = useState<"country" | "city">("country");
  const [occasionScope, setOccasionScope] = useState<"country" | "city">("country");
  const [writerOnlyWarning, setWriterOnlyWarning] = useState(false);
  const showMonthlyBooks = false;
  const currentCity = currentUser.profile.city;
  const normalizeCity = (value: string) => value.trim().toLocaleLowerCase("ru");
  const scopedEvents = events.filter((item) => eventScope === "country"
    ? !currentUser.profile.country || item.country?.toLocaleLowerCase("ru") === currentUser.profile.country.toLocaleLowerCase("ru")
    : !currentCity || normalizeCity(item.city) === normalizeCity(currentCity))
    .slice().sort((first, second) => Number(Boolean(second.pinned)) - Number(Boolean(first.pinned)) || eventTimestamp(first) - eventTimestamp(second));
  const scopedOccasions = (occasionScope === "country" || !currentCity ? occasions : occasions.filter((item) => !item.targetCities.length || item.targetCities.some((city) => normalizeCity(city) === normalizeCity(currentCity)))).slice().sort((first, second) => (Date.parse(second.createdAt) || second.id) - (Date.parse(first.createdAt) || first.id));
  const createPublication = () => currentUserType === "writer" || currentUserType === "blogger" ? onCreateExcerpt() : setWriterOnlyWarning(true);
  const homeMode = currentUser.profile.homeView ?? "feed";
  const feedEntries = [
    ...events.filter((item) => !currentCity || normalizeCity(item.city) === normalizeCity(currentCity)).map((item) => ({ kind: "event" as const, time: Date.parse(item.createdAt) || item.id, item })),
    ...occasions.filter((item) => !currentCity || !item.targetCities.length || item.targetCities.some((city) => normalizeCity(city) === normalizeCity(currentCity))).map((item) => ({ kind: "occasion" as const, time: Date.parse(item.createdAt) || item.id, item })),
    ...reviews.map((item) => ({ kind: "review" as const, time: Date.parse(item.createdAtValue ?? "") || item.id, item })),
    ...excerpts.map((item) => ({ kind: "excerpt" as const, time: Date.parse(item.createdAtValue ?? "") || item.id, item })),
    ...publisherNews.map((item) => ({ kind: "publisher-news" as const, time: Date.parse(item.createdAtValue ?? "") || item.id, item })),
  ].sort((first, second) => second.time - first.time);

  return (
    <main className={`content-scroll home-content home-mode-${homeMode}`}>
      {homeMode === "feed" && <section className="content-section home-feed">{feedEntries.map((entry, index) => {
        if (entry.kind === "event") return <EventCard key={`event-${entry.item.id}`} item={entry.item} own={entry.item.creatorId === currentUser.id} onOpen={() => setOpenedEvent(entry.item)} onEdit={() => onEditEvent(entry.item)} />;
        if (entry.kind === "occasion") return <OccasionCard key={`occasion-${entry.item.id}`} item={entry.item} own={entry.item.creatorId === currentUser.id} onOpen={() => setOpenedOccasion(entry.item)} onEdit={() => onEditOccasion(entry.item)} />;
        if (entry.kind === "review") { const review = entry.item; const book = catalogFromUsers(users).find((item) => item.id === review.linkedBookId) ?? catalogFromUsers(users).find((item) => item.title.toLowerCase() === review.book.replace(/[«»]/g, "").toLowerCase() && item.author.toLowerCase() === review.author.toLowerCase()); const reading: ReadingItem = { id: review.id, kind: "review", title: review.book, author: review.user, text: review.fullText, bodyHtml: review.bodyHtml, linkedBookId: review.linkedBookId, ownerId: review.ownerId, createdAt: review.createdAt, preview: review.quote, bookAuthor: review.author, rating: Number(review.rating) }; return <MaterialPreviewCard key={`review-${review.id}`} item={reading} index={index} owner={users.find((user) => user.id === review.ownerId)} book={book} onOpen={() => setReadingItem(reading)} onOpenUser={onOpenUser} onOpenBook={book ? () => setOpenedBlogBook(book) : undefined} />; }
        if (entry.kind === "publisher-news") return <PublisherNewsCard key={`publisher-news-${entry.item.id}`} item={entry.item} owner={users.find((user) => user.id === entry.item.ownerId)} onOpen={() => setOpenedPublisherNews(entry.item)} onOpenUser={onOpenUser} />;
        const excerpt = entry.item; const book = excerpt.linkedBookId ? catalogFromUsers(users).find((item) => item.id === excerpt.linkedBookId) : undefined; const reading: ReadingItem = { id: excerpt.id, kind: "excerpt", title: book?.title || "Публикация", author: excerpt.author, text: excerpt.fullText, preview: excerpt.text, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.linkedBookId, linkedBookIds: excerpt.linkedBookIds, ownerId: excerpt.ownerId, createdAt: excerpt.createdAt }; return <MaterialPreviewCard key={`excerpt-${excerpt.id}`} item={reading} index={index} owner={users.find((user) => user.id === excerpt.ownerId)} book={book} onOpen={() => setReadingItem(reading)} onOpenUser={onOpenUser} onOpenBook={book ? () => setOpenedBlogBook(book) : undefined} />;
      })}{!feedEntries.length && <EmptyContentState />}</section>}
      <section className="content-section events-section"><div className="section-heading"><div className="interactive-section-title"><button className="home-section-link" type="button" onClick={() => onNavigate("events")}>Книжные события</button><HomeScopeSwitch city={currentCity} country={currentUser.profile.country} value={eventScope} onChange={setEventScope} /></div></div>{scopedEvents.length ? <div className="events-grid">{scopedEvents.slice(0, 2).map((item) => <EventCard key={item.id} item={item} own={item.creatorId === currentUser.id} onOpen={() => setOpenedEvent(item)} onOpenBook={item.linkedBookId ? () => setOpenedBlogBook(catalogFromUsers(users).find((book) => book.id === item.linkedBookId) ?? null) : undefined} onEdit={() => onEditEvent(item)} />)}</div> : <EmptyContentState />}</section>

      <section className="content-section">
        <div className="section-heading">
          <button className="home-section-link" type="button" onClick={() => onNavigate("reviews")}>Рецензии</button>
        </div>
        {reviews.length > 0 ? (
          <div className="excerpt-grid review-material-grid">
            {reviews.map((review, index) => { const reviewBook = catalogFromUsers(users).find((book) => book.id === review.linkedBookId) ?? catalogFromUsers(users).find((book) => book.title.toLowerCase() === review.book.replace(/[«»]/g, "").toLowerCase() && book.author.toLowerCase() === review.author.toLowerCase()); const item: ReadingItem = { id: review.id, kind: "review", title: review.book, author: review.user, text: review.fullText, bodyHtml: review.bodyHtml, linkedBookId: review.linkedBookId, ownerId: review.ownerId, createdAt: review.createdAt, preview: review.quote, bookAuthor: review.author, rating: Number(review.rating) }; return <MaterialPreviewCard key={`${review.ownerId}-${review.id}`} item={item} index={index} owner={users.find((user) => user.id === review.ownerId)} book={reviewBook} onOpen={() => setReadingItem(item)} onOpenUser={onOpenUser} onOpenBook={reviewBook ? () => setOpenedBlogBook(reviewBook) : undefined} />; })}
          </div>
        ) : (
          <EmptyContentState action="Будьте первыми, напишите рецензию" onAction={onCreateReview} />
        )}
      </section>

      <section className="content-section">
        <div className="section-heading">
          <button className="home-section-link" type="button" onClick={() => onNavigate("publications")}>Публикации блога</button>
        </div>
        {excerpts.length > 0 ? (
          <div className="excerpt-grid">
            {excerpts.map((excerpt, index) => {
              const linkedBook = excerpt.linkedBookId ? catalogFromUsers(users).find((book) => book.id === excerpt.linkedBookId) : undefined;
              return (
            <MaterialPreviewCard key={`${excerpt.ownerId}-${excerpt.id}`} item={{ id: excerpt.id, kind: "excerpt", title: linkedBook?.title || "Публикация", author: excerpt.author, text: excerpt.fullText, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.linkedBookId, linkedBookIds: excerpt.linkedBookIds, ownerId: excerpt.ownerId, createdAt: excerpt.createdAt, preview: excerpt.text }} index={index} owner={users.find((user) => user.id === excerpt.ownerId)} book={linkedBook} onOpen={() => setReadingItem({ id: excerpt.id, kind: "excerpt", title: linkedBook?.title || "Публикация", author: excerpt.author, text: excerpt.fullText, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.linkedBookId, linkedBookIds: excerpt.linkedBookIds, ownerId: excerpt.ownerId, createdAt: excerpt.createdAt, preview: excerpt.text })} onOpenUser={onOpenUser} onOpenBook={linkedBook ? () => setOpenedBlogBook(linkedBook) : undefined} />
              );
            })}
          </div>
        ) : (
          <EmptyContentState action={currentUserType === "writer" || currentUserType === "blogger" ? "Будьте первыми, добавьте публикацию" : undefined} onAction={onCreateExcerpt} />
        )}
      </section>
      {openedBlogBook && <UnifiedBookModal book={openedBlogBook} users={users} onClose={() => setOpenedBlogBook(null)} onOpenUser={onOpenUser} onReport={!currentUser.isAdmin && !currentUser.books.some((book) => book.id === openedBlogBook.id) && !(currentUser.authorBooks ?? []).some((book) => book.id === openedBlogBook.id) ? () => openReportDialog({ kind: "book", id: openedBlogBook.id }) : undefined} />}
      {openedEvent && <EventModal item={openedEvent} users={users} currentUserId={currentUser.id} currentUser={currentUser} onOpenUser={onOpenUser} onOpenBook={openedEvent.linkedBookId ? () => {
        setOpenedBlogBook(catalogFromUsers(users).find((book) => book.id === openedEvent.linkedBookId) ?? null);
        setOpenedEvent(null);
      } : undefined} onClose={() => setOpenedEvent(null)} onEdit={openedEvent.creatorId === currentUser.id ? () => { onEditEvent(openedEvent); setOpenedEvent(null); } : undefined} onDelete={openedEvent.creatorId === currentUser.id ? async () => { if (!window.confirm(`Удалить событие «${openedEvent.title}»?`)) return; const response = await fetch(`/api/events/${openedEvent.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert("Не удалось удалить событие"); return; } window.location.reload(); } : undefined} onReport={!currentUser.isAdmin && openedEvent.creatorId !== currentUser.id ? () => openReportDialog({ kind: "event", id: openedEvent.id }) : undefined} />}

      {showMonthlyBooks && (
        <section className="content-section monthly-section">
          <div className="section-heading"><h2>Выбор редакции · июль</h2></div>
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
        <div className="section-heading"><div className="interactive-section-title"><button className="home-section-link" type="button" onClick={() => onNavigate("occasions")}>Поводы познакомиться</button><HomeScopeSwitch city={currentCity} country={currentUser.profile.country} value={occasionScope} onChange={setOccasionScope} /></div></div>
        {scopedOccasions.length ? <div className="occasion-grid home-occasion-grid">{scopedOccasions.slice(0, 2).map((item) => <OccasionCard key={item.id} item={item} own={item.creatorId === currentUser.id} onOpen={() => setOpenedOccasion(item)} onEdit={() => onEditOccasion(item)} />)}</div> : <EmptyContentState action="Будьте первыми, создайте повод" onAction={onCreateOccasion} />}
      </section>

      {readingItem && <ReadingModal item={readingItem} currentUser={currentUser} users={users} likedUserIds={likes[`${readingItem.kind}-${readingItem.id}`] ?? []} onToggleLike={() => onToggleLike(readingItem)} onComment={(text) => onComment(readingItem, text)} onClose={() => setReadingItem(null)} onOpenUser={onOpenUser} relationship={readingItem.ownerId ? relationshipFor(readingItem.ownerId) : undefined} isFollowing={readingItem.ownerId ? isFollowing(readingItem.ownerId) : false} onAddFriend={readingItem.ownerId ? (message) => onAddFriend(readingItem.ownerId!, message) : undefined} onFollow={readingItem.ownerId ? () => onFollow(readingItem.ownerId!) : undefined} onEdit={currentUser.isAdmin || readingItem.ownerId === currentUser.id ? () => void editReadingMaterial(readingItem, currentUser) : undefined} onDelete={currentUser.isAdmin || readingItem.ownerId === currentUser.id ? () => void deleteReadingMaterial(readingItem, currentUser) : undefined} onReport={!currentUser.isAdmin && readingItem.ownerId !== currentUser.id ? () => openReportDialog({ kind: readingItem.kind, id: readingItem.id }) : undefined} />}
      {openedOccasion && <OccasionModal item={openedOccasion} currentUser={currentUser} users={users} onOpenUser={onOpenUser} onOpenBook={(bookId) => { setOpenedBlogBook(catalogFromUsers(users).find((book) => book.id === bookId) ?? null); setOpenedOccasion(null); }} onClose={() => setOpenedOccasion(null)} onEdit={openedOccasion.creatorId === currentUser.id ? () => { onEditOccasion(openedOccasion); setOpenedOccasion(null); } : undefined} onDelete={openedOccasion.creatorId === currentUser.id ? async () => { if (!window.confirm("Удалить повод для знакомства?")) return; const response = await fetch(`/api/occasions/${openedOccasion.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert("Не удалось удалить повод"); return; } window.location.reload(); } : undefined} onReport={!currentUser.isAdmin && openedOccasion.creatorId !== currentUser.id ? () => openReportDialog({ kind: "occasion", id: openedOccasion.id }) : undefined} />}
      {openedPublisherNews && <PublisherNewsModal item={openedPublisherNews} owner={users.find((user) => user.id === openedPublisherNews.ownerId)} currentUser={currentUser} users={users} onClose={() => setOpenedPublisherNews(null)} onOpenUser={onOpenUser} onReport={!currentUser.isAdmin ? () => openReportDialog({ kind: "publisher_news", id: openedPublisherNews.id }) : undefined} />}
      {writerOnlyWarning && <div className="modal-backdrop" onMouseDown={() => setWriterOnlyWarning(false)}><section className="simple-warning-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><h2>Публикации могут создавать только писатели и блогеры</h2><button className="primary-button" type="button" onClick={() => setWriterOnlyWarning(false)}>Закрыть</button></section></div>}
    </main>
  );
}

export function EventsDirectoryPage({ events, currentUser, users, onHome, onCreate, onEdit, onOpenUser }: { events: BookEvent[]; currentUser: DemoUser; users: DemoUser[]; onHome: () => void; onCreate: () => void; onEdit: (item: BookEvent) => void; onOpenUser: (userId: number) => void }) {
  const [city, setCity] = useState(currentUser.profile.city);
  const [opened, setOpened] = useState<BookEvent | null>(null);
  const [openedBook, setOpenedBook] = useState<LibraryBook | AuthorBook | null>(null);
  const visible = events.filter((item) => item.status === "published" || item.creatorId === currentUser.id).filter((item) => !city || item.city.toLocaleLowerCase("ru") === city.toLocaleLowerCase("ru")).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || eventTimestamp(a) - eventTimestamp(b));
  const openBook = (item: BookEvent) => setOpenedBook(catalogFromUsers(users).find((book) => book.id === item.linkedBookId) ?? null);
  return <main className="content-scroll directory-page"><button className="back-button directory-home-button" type="button" onClick={onHome}>← На главную</button><div className="directory-heading"><div><span className="section-subtitle">Книжная афиша</span><h1>Книжные события</h1><p>{visible.length} событий в выбранном городе</p></div><div className="directory-controls"><CityFilter value={city} cities={events.filter((item) => item.status === "published" || item.creatorId === currentUser.id).map((item) => item.city)} onChange={setCity} /><button className="primary-button creation-action-button" type="button" onClick={onCreate}>Добавить событие</button></div></div>{visible.length ? <div className="events-grid">{visible.map((item) => <EventCard key={item.id} item={item} own={item.creatorId === currentUser.id} onOpen={() => setOpened(item)} onOpenBook={item.linkedBookId ? () => openBook(item) : undefined} onEdit={() => onEdit(item)} />)}</div> : <EmptyContentState action="Добавить событие" onAction={onCreate} />}{opened && <EventModal item={opened} users={users} currentUserId={currentUser.id} currentUser={currentUser} onOpenUser={onOpenUser} onOpenBook={opened.linkedBookId ? () => openBook(opened) : undefined} onClose={() => setOpened(null)} onEdit={opened.creatorId === currentUser.id ? () => { onEdit(opened); setOpened(null); } : undefined} onDelete={opened.creatorId === currentUser.id ? async () => { if (!window.confirm(`Удалить событие «${opened.title}»?`)) return; const response = await fetch(`/api/events/${opened.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert("Не удалось удалить событие"); return; } window.location.reload(); } : undefined} onReport={!currentUser.isAdmin && opened.creatorId !== currentUser.id ? () => openReportDialog({ kind: "event", id: opened.id }) : undefined} />}{openedBook && <UnifiedBookModal book={openedBook} users={users} onClose={() => setOpenedBook(null)} onReport={!currentUser.isAdmin && !currentUser.books.some((book) => book.id === openedBook.id) && !(currentUser.authorBooks ?? []).some((book) => book.id === openedBook.id) ? () => openReportDialog({ kind: "book", id: openedBook.id }) : undefined} />}</main>;
}

export function OccasionsDirectoryPage({ occasions, currentUser, users, onHome, onCreate, onEdit, onOpenUser }: { occasions: Occasion[]; currentUser: DemoUser; users: DemoUser[]; onHome: () => void; onCreate: () => void; onEdit: (item: Occasion) => void; onOpenUser: (id: number) => void }) {
  const [city, setCity] = useState(currentUser.profile.city);
  const [opened, setOpened] = useState<Occasion | null>(null);
  const [openedBook, setOpenedBook] = useState<LibraryBook | AuthorBook | null>(null);
  const visible = occasions.filter((item) => item.status === "published" || item.creatorId === currentUser.id).filter((item) => !city || !item.targetCities.length || item.targetCities.some((target) => target.toLocaleLowerCase("ru") === city.toLocaleLowerCase("ru"))).filter((item) => item.creatorId === currentUser.id || (item.targetGender === "Все" || item.targetGender === currentUser.profile.gender) && (item.targetProfileType === "Все" || item.targetProfileType === currentUser.profile.type));
  const eligible = occasions.filter((item) => item.creatorId === currentUser.id || (item.targetGender === "Все" || item.targetGender === currentUser.profile.gender) && (item.targetProfileType === "Все" || item.targetProfileType === currentUser.profile.type));
  return <main className="content-scroll directory-page"><button className="back-button directory-home-button" type="button" onClick={onHome}>← На главную</button><div className="directory-heading"><div><span className="section-subtitle">Знакомства по интересам</span><h1>Поводы познакомиться</h1><p>{visible.length} подходящих поводов</p></div><div className="directory-controls"><CityFilter value={city} cities={eligible.flatMap((item) => item.targetCities)} onChange={setCity} /><button className="primary-button creation-action-button" type="button" onClick={onCreate}>Предложить повод</button></div></div>{visible.length ? <div className="occasion-grid">{visible.map((item) => <OccasionCard key={item.id} item={item} own={item.creatorId === currentUser.id} onOpen={() => setOpened(item)} onEdit={() => onEdit(item)} />)}</div> : <EmptyContentState />}{opened && <OccasionModal item={opened} currentUser={currentUser} users={users} onOpenUser={onOpenUser} onOpenBook={(bookId) => { setOpenedBook(catalogFromUsers(users).find((book) => book.id === bookId) ?? null); setOpened(null); }} onClose={() => setOpened(null)} onEdit={opened.creatorId === currentUser.id ? () => { onEdit(opened); setOpened(null); } : undefined} onDelete={opened.creatorId === currentUser.id ? async () => { if (!window.confirm("Удалить повод для знакомства?")) return; const response = await fetch(`/api/occasions/${opened.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert("Не удалось удалить повод"); return; } window.location.reload(); } : undefined} onReport={!currentUser.isAdmin && opened.creatorId !== currentUser.id ? () => openReportDialog({ kind: "occasion", id: opened.id }) : undefined} />}{openedBook && <UnifiedBookModal book={openedBook} users={users} onOpenUser={onOpenUser} onClose={() => setOpenedBook(null)} />}</main>;
}

export function MaterialsDirectoryPage({ kind, reviews, excerpts, publisherNews = [], currentUser, users, likes, commenters, onCreate, onToggleLike, onComment, onOpenUser, relationshipFor, isFollowing, onAddFriend, onFollow }: { kind: "review" | "excerpt"; reviews: Review[]; excerpts: Excerpt[]; publisherNews?: PublisherNews[]; currentUser: DemoUser; users: DemoUser[]; likes: Record<string, number[]>; commenters: Record<string, number[]>; onCreate: () => void; onToggleLike: (item: ReadingItem) => void; onComment: (item: ReadingItem, text: string) => Promise<MaterialComment | null>; onOpenUser: (userId: number) => void; relationshipFor: (userId: number) => SocialRelationship; isFollowing: (userId: number) => boolean; onAddFriend: (userId: number, message: string) => void; onFollow: (userId: number) => void }) {
  const [sort, setSort] = useState<"created" | "popular">("created");
  const [opened, setOpened] = useState<ReadingItem | null>(null);
  const [openedBook, setOpenedBook] = useState<LibraryBook | AuthorBook | null>(null);
  const [openedPublisherNews, setOpenedPublisherNews] = useState<PublisherNews | null>(null);
  const materials = kind === "review" ? reviews : excerpts;
  const popularity = (id: number) => (likes[`${kind}-${id}`]?.length ?? 0) + (commenters[`${kind}-${id}`]?.length ?? 0);
  const sorted = useMemo(() => [...materials].sort((first, second) => sort === "popular" ? popularity(second.id) - popularity(first.id) || second.id - first.id : (Date.parse(second.createdAtValue ?? "") || second.id) - (Date.parse(first.createdAtValue ?? "") || first.id)), [materials, sort, likes, commenters]);
  const sortedPublisherNews = useMemo(() => [...publisherNews].sort((first, second) => (Date.parse(second.createdAtValue ?? "") || second.id) - (Date.parse(first.createdAtValue ?? "") || first.id)), [publisherNews]);
  const heading = kind === "review" ? "Рецензии" : "Публикации";
  return <main className="content-scroll directory-page">
    <div className="directory-heading"><div><span className="section-subtitle">Все материалы сообщества</span><h1>{heading}</h1><p>{sorted.length + (kind === "excerpt" ? sortedPublisherNews.length : 0)} материалов</p></div><div className="directory-controls materials-directory-controls"><label className="directory-control-field"><span>Сортировка</span><CustomSelect ariaLabel="Сортировка" value={sort} onChange={setSort} options={[{ value: "created", label: "По дате создания" }, { value: "popular", label: "По популярности" }]} /></label><button className="primary-button creation-action-button" type="button" onClick={onCreate}>{kind === "review" ? "Написать рецензию" : "Создать публикацию"}</button></div></div>
    <div className="excerpt-grid directory-material-grid">
      {kind === "review" ? (sorted as Review[]).map((review, index) => { const matchingBook = catalogFromUsers(users).find((book) => book.id === review.linkedBookId) ?? catalogFromUsers(users).find((book) => book.title.toLowerCase() === review.book.replace(/[«»]/g, "").toLowerCase() && book.author.toLowerCase() === review.author.toLowerCase()); const item: ReadingItem = { id: review.id, kind: "review", title: review.book, author: review.user, text: review.fullText, bodyHtml: review.bodyHtml, linkedBookId: review.linkedBookId, ownerId: review.ownerId, createdAt: review.createdAt, preview: review.quote, bookAuthor: review.author, rating: Number(review.rating) }; return <MaterialPreviewCard key={`${review.ownerId}-${review.id}`} item={item} index={index} owner={users.find((user) => user.id === review.ownerId)} book={matchingBook} likesCount={likes[`review-${review.id}`]?.length ?? 0} commentsCount={commenters[`review-${review.id}`]?.length ?? 0} onOpen={() => setOpened(item)} onOpenUser={onOpenUser} onOpenBook={matchingBook ? () => setOpenedBook(matchingBook) : undefined} />; }) : <>{(sorted as Excerpt[]).map((excerpt, index) => { const linkedBook = excerpt.linkedBookId ? catalogFromUsers(users).find((book) => book.id === excerpt.linkedBookId) : undefined; const item: ReadingItem = { id: excerpt.id, kind: "excerpt", title: linkedBook?.title || "Публикация", author: excerpt.author, text: excerpt.fullText, preview: excerpt.text, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.linkedBookId, ownerId: excerpt.ownerId, createdAt: excerpt.createdAt }; return <MaterialPreviewCard key={`${excerpt.ownerId}-${excerpt.id}`} item={item} index={index} owner={users.find((user) => user.id === excerpt.ownerId)} book={linkedBook} likesCount={likes[`excerpt-${excerpt.id}`]?.length ?? 0} commentsCount={commenters[`excerpt-${excerpt.id}`]?.length ?? 0} onOpen={() => setOpened(item)} onOpenUser={onOpenUser} onOpenBook={linkedBook ? () => setOpenedBook(linkedBook) : undefined} />; })}{sortedPublisherNews.map((item) => <PublisherNewsCard key={`publisher-news-${item.id}`} item={item} owner={users.find((user) => user.id === item.ownerId)} onOpen={() => setOpenedPublisherNews(item)} onOpenUser={onOpenUser} />)}</>}
    </div>
    {!sorted.length && (kind === "review" || !sortedPublisherNews.length) && <EmptyContentState />}
    {opened && <ReadingModal item={opened} currentUser={currentUser} users={users} likedUserIds={likes[`${opened.kind}-${opened.id}`] ?? []} onToggleLike={() => onToggleLike(opened)} onComment={(text) => onComment(opened, text)} onOpenUser={onOpenUser} onClose={() => setOpened(null)} relationship={opened.ownerId ? relationshipFor(opened.ownerId) : "none"} isFollowing={opened.ownerId ? isFollowing(opened.ownerId) : false} onAddFriend={(message) => opened.ownerId && onAddFriend(opened.ownerId, message)} onFollow={() => opened.ownerId && onFollow(opened.ownerId)} onReport={!currentUser.isAdmin && opened.ownerId !== currentUser.id ? () => openReportDialog({ kind: opened.kind, id: opened.id }) : undefined} />}
    {openedPublisherNews && <PublisherNewsModal item={openedPublisherNews} owner={users.find((user) => user.id === openedPublisherNews.ownerId)} currentUser={currentUser} users={users} onClose={() => setOpenedPublisherNews(null)} onOpenUser={onOpenUser} onReport={!currentUser.isAdmin ? () => openReportDialog({ kind: "publisher_news", id: openedPublisherNews.id }) : undefined} />}
    {openedBook && <UnifiedBookModal book={openedBook} users={users} onClose={() => setOpenedBook(null)} onReport={!currentUser.isAdmin && !currentUser.books.some((book) => book.id === openedBook.id) && !(currentUser.authorBooks ?? []).some((book) => book.id === openedBook.id) ? () => openReportDialog({ kind: "book", id: openedBook.id }) : undefined} />}
  </main>;
}

type CatalogDirectoryBook = LibraryBook & { addedAt: string; popularity: number };

export function AllBooksDirectoryPage({ users, currentUser, onOpenUser }: { users: DemoUser[]; currentUser: DemoUser; onOpenUser: (id: number) => void }) {
  const [books, setBooks] = useState<CatalogDirectoryBook[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"alphabetical" | "added" | "popular">("alphabetical");
  const [opened, setOpened] = useState<CatalogDirectoryBook | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; fetch("/api/books/catalog", { credentials: "same-origin", cache: "no-store" }).then((response) => response.json()).then((data: { books?: Array<Partial<CatalogDirectoryBook> & Pick<CatalogDirectoryBook, "id" | "author" | "title" | "addedAt" | "popularity">> }) => { if (!active) return; setBooks((data.books ?? []).map((book) => ({ genres: [], annotation: "", pages: "", format: "Бумажная", durationHours: "", durationMinutes: "", rating: 0, review: "", coverTone: "blue", ...book } as CatalogDirectoryBook))); }).catch(console.warn).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const visible = useMemo(() => { const needle = query.trim().toLocaleLowerCase("ru"); return books.filter((book) => !needle || `${book.title} ${book.author}`.toLocaleLowerCase("ru").includes(needle)).sort((first, second) => sort === "added" ? Date.parse(second.addedAt) - Date.parse(first.addedAt) || first.title.localeCompare(second.title, "ru") : sort === "popular" ? second.popularity - first.popularity || first.title.localeCompare(second.title, "ru") : first.title.localeCompare(second.title, "ru") || first.author.localeCompare(second.author, "ru")); }, [books, query, sort]);
  return <main className="content-scroll directory-page books-directory-page"><div className="directory-heading"><div><h1>Все книги</h1><p>{visible.length} книг</p></div><div className="directory-controls books-directory-controls"><label className="books-search-field"><span>Поиск по названию или автору</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название книги или автор" /></label><label className="directory-control-field"><span>Сортировка</span><CustomSelect ariaLabel="Сортировка книг" value={sort} onChange={setSort} options={[{ value: "alphabetical", label: "По алфавиту" }, { value: "added", label: "По дате добавления" }, { value: "popular", label: "По популярности" }]} /></label></div></div>{loading ? <p className="directory-loading">Загружаем книги…</p> : visible.length ? <div className="all-books-grid">{visible.map((book) => <article className="library-book material-clickable-card" role="button" tabIndex={0} key={book.id} onClick={() => setOpened(book)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpened(book); } }}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><div className="library-book-copy"><h3>{book.title}</h3><p>{book.author}</p><small>В библиотеках: {book.popularity}</small></div></article>)}</div> : <EmptyContentState />}{opened && <UnifiedBookModal book={opened} users={users} onOpenUser={onOpenUser} onClose={() => setOpened(null)} onReport={!currentUser.isAdmin && opened.creatorUserId !== currentUser.id ? () => openReportDialog({ kind: "book", id: opened.id }) : undefined} />}</main>;
}

export function SimpleDirectoryPage({ kind }: { kind: "communities" | "partners" }) {
  const communities = kind === "communities";
  return <main className="content-scroll directory-page simple-directory-page"><div className="directory-heading"><div><h1>{communities ? "Книжные сообщества" : "Наши партнеры"}</h1><p>{communities ? "Место для книжных клубов, объединений и совместного чтения." : "Проекты и организации, которые помогают развивать книжную культуру."}</p></div></div><EmptyContentState /></main>;
}
