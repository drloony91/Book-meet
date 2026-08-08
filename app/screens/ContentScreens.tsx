import { useMemo, useState } from "react";
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
  ReadingModal,
  UnifiedBookModal,
  monthlyBooks,
} from "../components/content/ContentComponents";
import { catalogFromUsers, eventTimestamp } from "../lib/domain";
import { openReportDialog } from "../components/safety/SafetyCenter";
import type {
  AuthorBook,
  BookEvent,
  DemoUser,
  Excerpt,
  LibraryBook,
  MaterialComment,
  Occasion,
  ReadingItem,
  Review,
} from "../types/domain";

export function HomeContent({ reviews, excerpts, events, occasions, currentUserType, onOpenUser, onCreateEvent, onEditEvent, onCreateOccasion, onEditOccasion, onCreateReview, onCreateExcerpt, onNavigate, currentUserName, currentUser, users, relationshipFor, isFollowing, onAddFriend, onFollow, likes, onToggleLike, onComment }: { reviews: Review[]; excerpts: Excerpt[]; events: BookEvent[]; occasions: Occasion[]; currentUserType: "reader" | "writer" | "blogger"; onOpenUser: (userId: number) => void; onCreateEvent: () => void; onEditEvent: (item: BookEvent) => void; onCreateOccasion: () => void; onEditOccasion: (item: Occasion) => void; onCreateReview: () => void; onCreateExcerpt: () => void; onNavigate: (page: "reviews" | "publications" | "events" | "occasions") => void; currentUserName: string; currentUser: DemoUser; users: DemoUser[]; relationshipFor: (userId: number) => "none" | "outgoing" | "incoming" | "friends"; isFollowing: (userId: number) => boolean; onAddFriend: (userId: number, message: string) => void; onFollow: (userId: number) => void; likes: Record<string, number[]>; onToggleLike: (item: ReadingItem) => void; onComment: (item: ReadingItem, text: string) => Promise<MaterialComment | null> }) {
  const [readingItem, setReadingItem] = useState<ReadingItem | null>(null);
  const [openedBlogBook, setOpenedBlogBook] = useState<LibraryBook | AuthorBook | null>(null);
  const [openedEvent, setOpenedEvent] = useState<BookEvent | null>(null);
  const [openedOccasion, setOpenedOccasion] = useState<Occasion | null>(null);
  const [eventScope, setEventScope] = useState<"country" | "city">("country");
  const [occasionScope, setOccasionScope] = useState<"country" | "city">("country");
  const [writerOnlyWarning, setWriterOnlyWarning] = useState(false);
  const showMonthlyBooks = false;
  const currentCity = currentUser.profile.city;
  const normalizeCity = (value: string) => value.trim().toLocaleLowerCase("ru");
  const scopedEvents = events.filter((item) => eventScope === "country"
    ? item.country?.toLocaleLowerCase("ru") === currentUser.profile.country?.toLocaleLowerCase("ru")
    : normalizeCity(item.city) === normalizeCity(currentCity))
    .slice().sort((first, second) => Number(Boolean(second.pinned)) - Number(Boolean(first.pinned)) || eventTimestamp(first) - eventTimestamp(second));
  const scopedOccasions = (occasionScope === "country" ? occasions : occasions.filter((item) => item.targetCities.some((city) => normalizeCity(city) === normalizeCity(currentCity)))).slice().sort((first, second) => (Date.parse(second.createdAt) || second.id) - (Date.parse(first.createdAt) || first.id));
  const createPublication = () => currentUserType === "writer" || currentUserType === "blogger" ? onCreateExcerpt() : setWriterOnlyWarning(true);
  const homeMode = typeof window !== "undefined" ? window.localStorage.getItem(`bookmeet:home-view:${currentUser.id}`) ?? "feed" : "feed";
  const feedEntries = [
    ...events.filter((item) => !currentCity || normalizeCity(item.city) === normalizeCity(currentCity)).map((item) => ({ kind: "event" as const, time: Date.parse(item.createdAt) || item.id, item })),
    ...occasions.filter((item) => !currentCity || item.targetCities.some((city) => normalizeCity(city) === normalizeCity(currentCity))).map((item) => ({ kind: "occasion" as const, time: Date.parse(item.createdAt) || item.id, item })),
    ...reviews.map((item) => ({ kind: "review" as const, time: Date.parse(item.createdAtValue ?? "") || item.id, item })),
    ...excerpts.map((item) => ({ kind: "excerpt" as const, time: Date.parse(item.createdAtValue ?? "") || item.id, item })),
  ].sort((first, second) => second.time - first.time);

  return (
    <main className={`content-scroll home-content home-mode-${homeMode}`}>
      {homeMode === "feed" && <section className="content-section home-feed">{feedEntries.map((entry, index) => {
        if (entry.kind === "event") return <EventCard key={`event-${entry.item.id}`} item={entry.item} own={entry.item.creatorId === currentUser.id} onOpen={() => setOpenedEvent(entry.item)} onEdit={() => onEditEvent(entry.item)} />;
        if (entry.kind === "occasion") return <OccasionCard key={`occasion-${entry.item.id}`} item={entry.item} own={entry.item.creatorId === currentUser.id} onOpen={() => setOpenedOccasion(entry.item)} onEdit={() => onEditOccasion(entry.item)} />;
        if (entry.kind === "review") { const review = entry.item; const book = catalogFromUsers(users).find((item) => item.title.toLowerCase() === review.book.replace(/[«»]/g, "").toLowerCase() && item.author.toLowerCase() === review.author.toLowerCase()); const reading: ReadingItem = { id: review.id, kind: "review", title: review.book, author: review.user, text: review.fullText, ownerId: review.ownerId, createdAt: review.createdAt, preview: review.quote, bookAuthor: review.author, rating: Number(review.rating) }; return <MaterialPreviewCard key={`review-${review.id}`} item={reading} index={index} owner={users.find((user) => user.id === review.ownerId)} book={book} onOpen={() => setReadingItem(reading)} onOpenUser={onOpenUser} onOpenBook={book ? () => setOpenedBlogBook(book) : undefined} />; }
        const excerpt = entry.item; const book = excerpt.linkedBookId ? catalogFromUsers(users).find((item) => item.id === excerpt.linkedBookId) : undefined; const reading: ReadingItem = { id: excerpt.id, kind: "excerpt", title: book?.title || "Публикация", author: excerpt.author, text: excerpt.fullText, preview: excerpt.text, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.linkedBookId, ownerId: excerpt.ownerId, createdAt: excerpt.createdAt }; return <MaterialPreviewCard key={`excerpt-${excerpt.id}`} item={reading} index={index} owner={users.find((user) => user.id === excerpt.ownerId)} book={book} onOpen={() => setReadingItem(reading)} onOpenUser={onOpenUser} onOpenBook={book ? () => setOpenedBlogBook(book) : undefined} />;
      })}{!feedEntries.length && <EmptyContentState />}</section>}
      <section className="content-section events-section"><div className="section-heading"><div><div className="interactive-section-title"><h2>Книжные события</h2><HomeScopeSwitch city={currentCity} country={currentUser.profile.country} value={eventScope} onChange={setEventScope} /></div><span className="section-subtitle">Встречи, ярмарки, презентации и книжные клубы</span></div><div className="section-heading-actions"><button type="button" className="secondary-action-button" onClick={onCreateEvent}>Добавить событие</button><button type="button" className="secondary-action-button" onClick={() => onNavigate("events")}>Смотреть всё</button></div></div>{scopedEvents.length ? <div className="events-grid">{scopedEvents.slice(0, 2).map((item) => <EventCard key={item.id} item={item} own={item.creatorId === currentUser.id} onOpen={() => setOpenedEvent(item)} onOpenBook={item.linkedBookId ? () => setOpenedBlogBook(catalogFromUsers(users).find((book) => book.id === item.linkedBookId) ?? null) : undefined} onEdit={() => onEditEvent(item)} />)}</div> : <EmptyContentState action="Будьте первыми, добавьте событие" onAction={onCreateEvent} />}</section>

      <section className="content-section">
        <div className="section-heading">
          <div><h2>Свежие мнения</h2><span className="section-subtitle">Последние добавленные рецензии</span></div>
          <div className="section-heading-actions"><button type="button" className="secondary-action-button" onClick={onCreateReview}>Написать рецензию</button><button type="button" className="secondary-action-button" onClick={() => onNavigate("reviews")}>Смотреть всё</button></div>
        </div>
        {reviews.length > 0 ? (
          <div className="excerpt-grid review-material-grid">
            {reviews.map((review, index) => { const reviewBook = catalogFromUsers(users).find((book) => book.title.toLowerCase() === review.book.replace(/[«»]/g, "").toLowerCase() && book.author.toLowerCase() === review.author.toLowerCase()); const item: ReadingItem = { id: review.id, kind: "review", title: review.book, author: review.user, text: review.fullText, ownerId: review.ownerId, createdAt: review.createdAt, preview: review.quote, bookAuthor: review.author, rating: Number(review.rating) }; return <MaterialPreviewCard key={`${review.ownerId}-${review.id}`} item={item} index={index} owner={users.find((user) => user.id === review.ownerId)} book={reviewBook} onOpen={() => setReadingItem(item)} onOpenUser={onOpenUser} onOpenBook={reviewBook ? () => setOpenedBlogBook(reviewBook) : undefined} />; })}
          </div>
        ) : (
          <EmptyContentState action="Будьте первыми, напишите рецензию" onAction={onCreateReview} />
        )}
      </section>

      <section className="content-section">
        <div className="section-heading">
          <div><h2>Пишут сейчас</h2><span className="section-subtitle">Последние публикации блога</span></div>
          <div className="section-heading-actions"><button type="button" className="secondary-action-button" onClick={createPublication}>Создать публикацию</button><button type="button" className="secondary-action-button" onClick={() => onNavigate("publications")}>Смотреть всё</button></div>
        </div>
        {excerpts.length > 0 ? (
          <div className="excerpt-grid">
            {excerpts.map((excerpt, index) => {
              const linkedBook = excerpt.linkedBookId ? catalogFromUsers(users).find((book) => book.id === excerpt.linkedBookId) : undefined;
              return (
            <MaterialPreviewCard key={`${excerpt.ownerId}-${excerpt.id}`} item={{ id: excerpt.id, kind: "excerpt", title: linkedBook?.title || "Публикация", author: excerpt.author, text: excerpt.fullText, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.linkedBookId, ownerId: excerpt.ownerId, createdAt: excerpt.createdAt, preview: excerpt.text }} index={index} owner={users.find((user) => user.id === excerpt.ownerId)} book={linkedBook} onOpen={() => setReadingItem({ id: excerpt.id, kind: "excerpt", title: linkedBook?.title || "Публикация", author: excerpt.author, text: excerpt.fullText, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.linkedBookId, ownerId: excerpt.ownerId, createdAt: excerpt.createdAt, preview: excerpt.text })} onOpenUser={onOpenUser} onOpenBook={linkedBook ? () => setOpenedBlogBook(linkedBook) : undefined} />
              );
            })}
          </div>
        ) : (
          <EmptyContentState action={currentUserType === "writer" || currentUserType === "blogger" ? "Будьте первыми, добавьте публикацию" : undefined} onAction={onCreateExcerpt} />
        )}
      </section>
      {openedBlogBook && <UnifiedBookModal book={openedBlogBook} users={users} onClose={() => setOpenedBlogBook(null)} onOpenUser={onOpenUser} onReport={!currentUser.isAdmin && !currentUser.books.some((book) => book.id === openedBlogBook.id) && !(currentUser.authorBooks ?? []).some((book) => book.id === openedBlogBook.id) ? () => openReportDialog({ kind: "book", id: openedBlogBook.id }) : undefined} />}
      {openedEvent && <EventModal item={openedEvent} users={users} currentUserId={currentUser.id} onOpenUser={onOpenUser} onOpenBook={openedEvent.linkedBookId ? () => {
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
        <div className="section-heading"><div className="interactive-section-title"><h2>Поводы познакомиться</h2><HomeScopeSwitch city={currentCity} country={currentUser.profile.country} value={occasionScope} onChange={setOccasionScope} /></div><div className="section-heading-actions"><button type="button" className="secondary-action-button" onClick={onCreateOccasion}>Предложить повод</button><button type="button" className="secondary-action-button" onClick={() => onNavigate("occasions")}>Смотреть всё</button></div></div>
        {scopedOccasions.length ? <div className="occasion-grid home-occasion-grid">{scopedOccasions.slice(0, 2).map((item) => <OccasionCard key={item.id} item={item} own={item.creatorId === currentUser.id} onOpen={() => setOpenedOccasion(item)} onEdit={() => onEditOccasion(item)} />)}</div> : <EmptyContentState action="Будьте первыми, создайте повод" onAction={onCreateOccasion} />}
      </section>

      {readingItem && <ReadingModal item={readingItem} currentUser={currentUser} users={users} likedUserIds={likes[`${readingItem.kind}-${readingItem.id}`] ?? []} onToggleLike={() => onToggleLike(readingItem)} onComment={(text) => onComment(readingItem, text)} onClose={() => setReadingItem(null)} onOpenUser={onOpenUser} relationship={readingItem.ownerId ? relationshipFor(readingItem.ownerId) : undefined} isFollowing={readingItem.ownerId ? isFollowing(readingItem.ownerId) : false} onAddFriend={readingItem.ownerId ? (message) => onAddFriend(readingItem.ownerId!, message) : undefined} onFollow={readingItem.ownerId ? () => onFollow(readingItem.ownerId!) : undefined} onEdit={currentUser.isAdmin || readingItem.ownerId === currentUser.id ? () => void editReadingMaterial(readingItem, currentUser) : undefined} onDelete={currentUser.isAdmin || readingItem.ownerId === currentUser.id ? () => void deleteReadingMaterial(readingItem, currentUser) : undefined} onReport={!currentUser.isAdmin && readingItem.ownerId !== currentUser.id ? () => openReportDialog({ kind: readingItem.kind, id: readingItem.id }) : undefined} />}
      {openedOccasion && <OccasionModal item={openedOccasion} onOpenUser={onOpenUser} onClose={() => setOpenedOccasion(null)} onEdit={openedOccasion.creatorId === currentUser.id ? () => { onEditOccasion(openedOccasion); setOpenedOccasion(null); } : undefined} onDelete={openedOccasion.creatorId === currentUser.id ? async () => { if (!window.confirm("Удалить повод для знакомства?")) return; const response = await fetch(`/api/occasions/${openedOccasion.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert("Не удалось удалить повод"); return; } window.location.reload(); } : undefined} onReport={!currentUser.isAdmin && openedOccasion.creatorId !== currentUser.id ? () => openReportDialog({ kind: "occasion", id: openedOccasion.id }) : undefined} />}
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
  return <main className="content-scroll directory-page"><button className="back-button directory-home-button" type="button" onClick={onHome}>← На главную</button><div className="directory-heading"><div><span className="section-subtitle">Книжная афиша</span><h1>Книжные события</h1><p>{visible.length} событий в выбранном городе</p></div><div className="directory-controls"><CityFilter value={city} cities={events.filter((item) => item.status === "published" || item.creatorId === currentUser.id).map((item) => item.city)} onChange={setCity} /><button className="primary-button creation-action-button" type="button" onClick={onCreate}>Добавить событие</button></div></div>{visible.length ? <div className="events-grid">{visible.map((item) => <EventCard key={item.id} item={item} own={item.creatorId === currentUser.id} onOpen={() => setOpened(item)} onOpenBook={item.linkedBookId ? () => openBook(item) : undefined} onEdit={() => onEdit(item)} />)}</div> : <EmptyContentState action="Добавить событие" onAction={onCreate} />}{opened && <EventModal item={opened} users={users} currentUserId={currentUser.id} onOpenUser={onOpenUser} onOpenBook={opened.linkedBookId ? () => openBook(opened) : undefined} onClose={() => setOpened(null)} onEdit={opened.creatorId === currentUser.id ? () => { onEdit(opened); setOpened(null); } : undefined} onDelete={opened.creatorId === currentUser.id ? async () => { if (!window.confirm(`Удалить событие «${opened.title}»?`)) return; const response = await fetch(`/api/events/${opened.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert("Не удалось удалить событие"); return; } window.location.reload(); } : undefined} onReport={!currentUser.isAdmin && opened.creatorId !== currentUser.id ? () => openReportDialog({ kind: "event", id: opened.id }) : undefined} />}{openedBook && <UnifiedBookModal book={openedBook} users={users} onClose={() => setOpenedBook(null)} onReport={!currentUser.isAdmin && !currentUser.books.some((book) => book.id === openedBook.id) && !(currentUser.authorBooks ?? []).some((book) => book.id === openedBook.id) ? () => openReportDialog({ kind: "book", id: openedBook.id }) : undefined} />}</main>;
}

export function OccasionsDirectoryPage({ occasions, currentUser, onHome, onCreate, onEdit, onOpenUser }: { occasions: Occasion[]; currentUser: DemoUser; onHome: () => void; onCreate: () => void; onEdit: (item: Occasion) => void; onOpenUser: (id: number) => void }) {
  const [city, setCity] = useState(currentUser.profile.city);
  const [opened, setOpened] = useState<Occasion | null>(null);
  const visible = occasions.filter((item) => item.status === "published" || item.creatorId === currentUser.id).filter((item) => !city || item.targetCities.some((target) => target.toLocaleLowerCase("ru") === city.toLocaleLowerCase("ru"))).filter((item) => item.creatorId === currentUser.id || (item.targetGender === "Все" || item.targetGender === currentUser.profile.gender) && (item.targetProfileType === "Все" || item.targetProfileType === currentUser.profile.type));
  const eligible = occasions.filter((item) => item.creatorId === currentUser.id || (item.targetGender === "Все" || item.targetGender === currentUser.profile.gender) && (item.targetProfileType === "Все" || item.targetProfileType === currentUser.profile.type));
  return <main className="content-scroll directory-page"><button className="back-button directory-home-button" type="button" onClick={onHome}>← На главную</button><div className="directory-heading"><div><span className="section-subtitle">Знакомства по интересам</span><h1>Поводы познакомиться</h1><p>{visible.length} подходящих поводов</p></div><div className="directory-controls"><CityFilter value={city} cities={eligible.flatMap((item) => item.targetCities)} onChange={setCity} /><button className="primary-button creation-action-button" type="button" onClick={onCreate}>Предложить повод</button></div></div>{visible.length ? <div className="occasion-grid">{visible.map((item) => <OccasionCard key={item.id} item={item} own={item.creatorId === currentUser.id} onOpen={() => setOpened(item)} onEdit={() => onEdit(item)} />)}</div> : <EmptyContentState action="Предложить повод для знакомства" onAction={onCreate} />}{opened && <OccasionModal item={opened} onOpenUser={onOpenUser} onClose={() => setOpened(null)} onEdit={opened.creatorId === currentUser.id ? () => { onEdit(opened); setOpened(null); } : undefined} onDelete={opened.creatorId === currentUser.id ? async () => { if (!window.confirm("Удалить повод для знакомства?")) return; const response = await fetch(`/api/occasions/${opened.id}`, { method: "DELETE", credentials: "same-origin" }); if (!response.ok) { window.alert("Не удалось удалить повод"); return; } window.location.reload(); } : undefined} onReport={!currentUser.isAdmin && opened.creatorId !== currentUser.id ? () => openReportDialog({ kind: "occasion", id: opened.id }) : undefined} />}</main>;
}

export function MaterialsDirectoryPage({ kind, reviews, excerpts, currentUser, users, likes, commenters, onCreate, onToggleLike, onComment, onOpenUser, relationshipFor, isFollowing, onAddFriend, onFollow }: { kind: "review" | "excerpt"; reviews: Review[]; excerpts: Excerpt[]; currentUser: DemoUser; users: DemoUser[]; likes: Record<string, number[]>; commenters: Record<string, number[]>; onCreate: () => void; onToggleLike: (item: ReadingItem) => void; onComment: (item: ReadingItem, text: string) => Promise<MaterialComment | null>; onOpenUser: (userId: number) => void; relationshipFor: (userId: number) => "none" | "outgoing" | "incoming" | "friends"; isFollowing: (userId: number) => boolean; onAddFriend: (userId: number, message: string) => void; onFollow: (userId: number) => void }) {
  const [sort, setSort] = useState<"created" | "popular">("created");
  const [opened, setOpened] = useState<ReadingItem | null>(null);
  const [openedBook, setOpenedBook] = useState<LibraryBook | AuthorBook | null>(null);
  const materials = kind === "review" ? reviews : excerpts;
  const popularity = (id: number) => (likes[`${kind}-${id}`]?.length ?? 0) + (commenters[`${kind}-${id}`]?.length ?? 0);
  const sorted = useMemo(() => [...materials].sort((first, second) => sort === "popular" ? popularity(second.id) - popularity(first.id) || second.id - first.id : (Date.parse(second.createdAtValue ?? "") || second.id) - (Date.parse(first.createdAtValue ?? "") || first.id)), [materials, sort, likes, commenters]);
  const heading = kind === "review" ? "Рецензии" : "Публикации";
  return <main className="content-scroll directory-page"><div className="directory-heading"><div><span className="section-subtitle">Все материалы сообщества</span><h1>{heading}</h1><p>{sorted.length} материалов</p></div><div className="directory-controls materials-directory-controls"><label className="directory-control-field"><span>Сортировка</span><CustomSelect ariaLabel="Сортировка" value={sort} onChange={setSort} options={[{ value: "created", label: "По дате создания" }, { value: "popular", label: "По популярности" }]} /></label><button className="primary-button creation-action-button" type="button" onClick={onCreate}>{kind === "review" ? "Написать рецензию" : "Создать публикацию"}</button></div></div><div className="excerpt-grid directory-material-grid">{kind === "review" ? (sorted as Review[]).map((review, index) => { const matchingBook = catalogFromUsers(users).find((book) => book.title.toLowerCase() === review.book.replace(/[«»]/g, "").toLowerCase() && book.author.toLowerCase() === review.author.toLowerCase()); const item: ReadingItem = { id: review.id, kind: "review", title: review.book, author: review.user, text: review.fullText, ownerId: review.ownerId, createdAt: review.createdAt, preview: review.quote, bookAuthor: review.author, rating: Number(review.rating) }; return <MaterialPreviewCard key={`${review.ownerId}-${review.id}`} item={item} index={index} owner={users.find((user) => user.id === review.ownerId)} book={matchingBook} likesCount={likes[`review-${review.id}`]?.length ?? 0} commentsCount={commenters[`review-${review.id}`]?.length ?? 0} onOpen={() => setOpened(item)} onOpenUser={onOpenUser} onOpenBook={matchingBook ? () => setOpenedBook(matchingBook) : undefined} />; }) : (sorted as Excerpt[]).map((excerpt, index) => { const linkedBook = excerpt.linkedBookId ? catalogFromUsers(users).find((book) => book.id === excerpt.linkedBookId) : undefined; const item: ReadingItem = { id: excerpt.id, kind: "excerpt", title: linkedBook?.title || "Публикация", author: excerpt.author, text: excerpt.fullText, preview: excerpt.text, bodyHtml: excerpt.bodyHtml, linkedBookId: excerpt.linkedBookId, ownerId: excerpt.ownerId, createdAt: excerpt.createdAt }; return <MaterialPreviewCard key={`${excerpt.ownerId}-${excerpt.id}`} item={item} index={index} owner={users.find((user) => user.id === excerpt.ownerId)} book={linkedBook} likesCount={likes[`excerpt-${excerpt.id}`]?.length ?? 0} commentsCount={commenters[`excerpt-${excerpt.id}`]?.length ?? 0} onOpen={() => setOpened(item)} onOpenUser={onOpenUser} onOpenBook={linkedBook ? () => setOpenedBook(linkedBook) : undefined} />; })}</div>{!sorted.length && <EmptyContentState />}{opened && <ReadingModal item={opened} currentUser={currentUser} users={users} likedUserIds={likes[`${opened.kind}-${opened.id}`] ?? []} onToggleLike={() => onToggleLike(opened)} onComment={(text) => onComment(opened, text)} onOpenUser={onOpenUser} onClose={() => setOpened(null)} relationship={opened.ownerId ? relationshipFor(opened.ownerId) : "none"} isFollowing={opened.ownerId ? isFollowing(opened.ownerId) : false} onAddFriend={(message) => opened.ownerId && onAddFriend(opened.ownerId, message)} onFollow={() => opened.ownerId && onFollow(opened.ownerId)} onReport={!currentUser.isAdmin && opened.ownerId !== currentUser.id ? () => openReportDialog({ kind: opened.kind, id: opened.id }) : undefined} />}{openedBook && <UnifiedBookModal book={openedBook} users={users} onClose={() => setOpenedBook(null)} onReport={!currentUser.isAdmin && !currentUser.books.some((book) => book.id === openedBook.id) && !(currentUser.authorBooks ?? []).some((book) => book.id === openedBook.id) ? () => openReportDialog({ kind: "book", id: openedBook.id }) : undefined} />}</main>;
}
