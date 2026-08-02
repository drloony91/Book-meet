import { useMemo, useState } from "react";
import { CustomSelect } from "../components/common/CustomSelect";
import { CityFilter } from "../components/content/ContentComponents";
import { userBookMatches } from "../lib/domain";
import type { BookEvent, DemoUser } from "../types/domain";

export function UsersDirectoryPage({ currentUser, users, onOpenUser }: { currentUser: DemoUser; users: DemoUser[]; onOpenUser: (userId: number) => void }) {
  const [sort, setSort] = useState<"registration" | "matches">("matches");
  const [city, setCity] = useState("");
  const [profileType, setProfileType] = useState<"all" | "Читатель" | "Писатель" | "Блогер">("all");
  const publicUsers = useMemo(() => users.filter((user) => !user.isAdmin), [users]);
  const sortedUsers = useMemo(
    () => publicUsers
      .filter((user) => user.id !== currentUser.id)
      .filter((user) => profileType === "all" || user.profile.type === profileType)
      .filter((user) => !city || user.profile.city.trim().toLocaleLowerCase("ru") === city.trim().toLocaleLowerCase("ru"))
      .map((user) => ({ user, matches: userBookMatches(currentUser, user) }))
      .sort((first, second) => sort === "matches"
        ? second.matches.total - first.matches.total || second.user.id - first.user.id
        : (Date.parse(second.user.joinedAt ?? "") || second.user.id) - (Date.parse(first.user.joinedAt ?? "") || first.user.id)),
    [city, currentUser, profileType, publicUsers, sort],
  );
  const cityUsers = publicUsers.filter((user) => user.id !== currentUser.id && user.profile.city.trim().toLocaleLowerCase("ru") === currentUser.profile.city.trim().toLocaleLowerCase("ru")).length;

  return <main className="content-scroll directory-page">
    <div className="directory-heading">
      <div><span className="section-subtitle">Сообщество Book Meet</span><h1>Пользователи</h1><div className="users-directory-metrics"><p>Всего пользователей — {publicUsers.length}</p><p>Пользователей в вашем городе — {cityUsers}</p></div></div>
      <div className="directory-controls directory-filter-controls">
        <label className="directory-control-field"><span>Кого вы ищете?</span><CustomSelect ariaLabel="Кого вы ищете?" value={profileType} onChange={setProfileType} options={[{ value: "all", label: "Всех" }, { value: "Читатель", label: "Читателей" }, { value: "Писатель", label: "Писателей" }, { value: "Блогер", label: "Блогеров" }]} /></label>
        <div className="directory-control-field"><span>Город</span><CityFilter value={city} cities={publicUsers.filter((user) => user.id !== currentUser.id).map((user) => user.profile.city)} onChange={setCity} /></div>
        <label className="directory-control-field"><span>Сортировка</span><CustomSelect ariaLabel="Сортировка" value={sort} onChange={setSort} options={[{ value: "matches", label: "По книжным совпадениям" }, { value: "registration", label: "По дате регистрации" }]} /></label>
      </div>
    </div>
    <div className="users-directory-grid">{sortedUsers.map(({ user, matches }) => <article className="directory-user-card material-clickable-card" role="button" tabIndex={0} key={user.id} onClick={() => onOpenUser(user.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenUser(user.id); } }}>
      <span className={`avatar avatar-lg avatar-${user.color} ${user.avatarUrl ? "has-photo" : ""}`} style={user.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}>{!user.avatarUrl && user.initials}{user.online && <span className="online-dot" />}</span>
      <div><span>{user.profile.type}{user.profile.city ? ` · ${user.profile.city}` : ""} · <b className={user.online ? "online-copy" : "offline-copy"}>{user.online ? "в сети" : "не в сети"}</b></span><h2>{user.profile.name}</h2><p>{user.profile.bio || "Пользователь пока ничего о себе не рассказал."}</p></div>
      <div className="user-match-summary"><strong>{matches.total}</strong><span>книжных совпадений</span><small>{matches.books} книг · {matches.favoriteGenres} любимых жанров · {matches.dislikedGenres} нелюбимых жанров</small></div>
      <small>Зарегистрирован(а) {user.joined}</small>
    </article>)}</div>
  </main>;
}

export function PublishingDirectoryPage({ users, events, onOpenUser }: { users: DemoUser[]; events: BookEvent[]; onOpenUser: (userId: number) => void }) {
  const publishers = useMemo(() => users
    .filter((user) => !user.isAdmin && user.profile.type === "Издатель" && user.profile.publisherStatus === "approved")
    .sort((first, second) => (Date.parse(second.joinedAt ?? "") || second.id) - (Date.parse(first.joinedAt ?? "") || first.id)), [users]);
  return <main className="content-scroll directory-page publishing-directory-page">
    <div className="directory-heading"><div><h1>Новинки издательств</h1><p>Познакомьтесь с издательствами! Книги, события и новости издательства — в одном месте.</p></div></div>
    {publishers.length ? <div className="publishing-list">{publishers.map((publisher) => {
      const latestNews = [...(publisher.publisherNews ?? [])].sort((first, second) => Date.parse(second.createdAtValue ?? second.createdAt) - Date.parse(first.createdAtValue ?? first.createdAt))[0];
      const latestEvent = events.filter((item) => item.creatorId === publisher.id && item.status === "published").sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))[0];
      return <article className="publishing-card" key={publisher.id} onClick={() => onOpenUser(publisher.id)}>
        <div className="publishing-card-intro">
          <button className={`avatar avatar-lg avatar-${publisher.color} ${publisher.avatarUrl ? "has-photo" : ""}`} style={publisher.avatarUrl ? { backgroundImage: `url(${publisher.avatarUrl})` } : undefined} type="button" onClick={() => onOpenUser(publisher.id)}>{!publisher.avatarUrl && publisher.initials}</button>
          <div className="publishing-card-copy"><h2>{publisher.profile.name}</h2><p>{publisher.profile.bio || "Издательство пока не добавило описание."}</p></div>
        </div>
        <div className="publishing-latest-books">{(publisher.authorBooks ?? []).slice(0, 3).map((book) => <div className="publishing-mini-book" key={book.id}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><div><strong>{book.title}</strong><span>{book.author}</span><p>{book.annotation}</p></div></div>)}</div>
        {(latestNews || latestEvent) && <div className="publishing-card-updates">
          <div>{latestNews ? <><span className="section-subtitle">Последняя новость</span><strong>{latestNews.title}</strong><p>{latestNews.previewText}</p></> : <p>Новостей пока нет.</p>}</div>
          <i aria-hidden="true" />
          <div>{latestEvent ? <><span className="section-subtitle">Последнее событие</span><strong>{latestEvent.title}</strong><p>{latestEvent.date} · {latestEvent.city} · {latestEvent.summary}</p></> : <p>Событий пока нет.</p>}</div>
        </div>}
      </article>;
    })}</div> : <div className="profile-tab-placeholder">Подтверждённых издательств пока нет.</div>}
  </main>;
}
