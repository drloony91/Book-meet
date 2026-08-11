import { useMemo, useState } from "react";
import { CustomSelect } from "../components/common/CustomSelect";
import { CityFilter } from "../components/content/ContentComponents";
import { userBookMatches } from "../lib/domain";
import type { BookEvent, DemoUser, PublicOrganization } from "../types/domain";

export function UsersDirectoryPage({ currentUser, users, onOpenUser }: { currentUser: DemoUser; users: DemoUser[]; onOpenUser: (userId: number) => void }) {
  const [sort, setSort] = useState<"registration" | "matches">("matches");
  const [city, setCity] = useState("");
  const [profileType, setProfileType] = useState<"all" | "Читатель" | "Писатель" | "Блогер">("all");
  const publicUsers = useMemo(() => users.filter((user) => !user.isAdmin && !user.deletedAt && !user.purged), [users]);
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
  return <OrganizationDirectoryPage type="Издатель" users={users} events={events} onOpenUser={onOpenUser} />;
}

export function CommunitiesDirectoryPage({ users, events, onOpenUser }: { users: DemoUser[]; events: BookEvent[]; onOpenUser: (userId: number) => void }) {
  return <OrganizationDirectoryPage type="Сообщество" users={users} events={events} onOpenUser={onOpenUser} />;
}

export function PublicOrganizationDirectoryPage({ type, organizations, onOpen }: { type: "Издатель" | "Сообщество"; organizations: PublicOrganization[]; onOpen: () => void }) {
  const [query, setQuery] = useState("");
  const [communityType, setCommunityType] = useState("all");
  const community = type === "Сообщество";
  const available = useMemo(() => organizations.filter((item) => item.type === type), [organizations, type]);
  const communityTypes = useMemo(() => Array.from(new Set(available.map((item) => item.communityType?.trim()).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, "ru")), [available]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    return available.filter((item) => (!needle || item.name.toLocaleLowerCase("ru").includes(needle)) && (!community || communityType === "all" || item.communityType === communityType));
  }, [available, community, communityType, query]);
  return <main className="content-scroll directory-page publishing-directory-page">
    <div className="directory-heading"><div><h1>{community ? "Книжные сообщества" : "Новинки издательств"}</h1><p>{community ? "Книжные клубы, объединения, их книги, события и новости." : "Познакомьтесь с издательствами! Книги, события и новости издательства — в одном месте."}</p></div><div className={`organization-directory-filters ${community ? "has-community-type" : ""}`}><label className="books-search-field"><span>Поиск по названию</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={community ? "Название сообщества" : "Название издательства"} /></label>{community && <label className="directory-control-field"><span>Тип сообщества</span><CustomSelect ariaLabel="Тип сообщества" value={communityType} onChange={setCommunityType} options={[{ value: "all", label: "Все типы" }, ...communityTypes.map((item) => ({ value: item, label: item }))]} /></label>}</div></div>
    {visible.length ? <div className="publishing-list">{visible.map((organization) => <article className="publishing-card material-clickable-card" role="button" tabIndex={0} key={organization.id} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}><div className="publishing-card-intro"><span className={`avatar avatar-lg avatar-${organization.color} ${organization.avatarUrl ? "has-photo" : ""}`} style={organization.avatarUrl ? { backgroundImage: `url(${organization.avatarUrl})` } : undefined}>{!organization.avatarUrl && organization.initials}</span><div className="publishing-card-copy"><span className="section-subtitle">{organization.type}{organization.communityType ? ` · ${organization.communityType}` : ""}{organization.city ? ` · ${organization.city}` : ""}</span><h2>{organization.name}</h2><p>{organization.bio || `${community ? "Сообщество" : "Издательство"} пока не добавило описание.`}</p></div></div></article>)}</div> : <div className="profile-tab-placeholder">{query ? "Ничего не найдено." : `Подтверждённых ${community ? "сообществ" : "издательств"} пока нет.`}</div>}
  </main>;
}

function OrganizationDirectoryPage({ type, users, events, onOpenUser }: { type: "Издатель" | "Сообщество"; users: DemoUser[]; events: BookEvent[]; onOpenUser: (userId: number) => void }) {
  const [query, setQuery] = useState("");
  const [communityType, setCommunityType] = useState("all");
  const communityTypes = useMemo(() => Array.from(new Set(users.filter((user) => user.profile.type === "Сообщество").map((user) => user.profile.communityType?.trim()).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, "ru")), [users]);
  const organizations = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    const activity = (user: DemoUser) => Math.max(
      Date.parse(user.joinedAt ?? "") || user.id,
      ...(user.publisherNews ?? []).map((item) => Date.parse(item.createdAtValue ?? item.createdAt) || item.id),
      ...events.filter((item) => item.creatorId === user.id && item.status === "published").map((item) => Date.parse(item.createdAt) || item.id),
      ...(user.authorBooks ?? []).map((book) => Date.parse(book.createdAtValue ?? "") || book.id),
    );
    return users
      .filter((user) => !user.isAdmin && user.profile.type === type && user.profile.publisherStatus === "approved")
      .filter((user) => !needle || user.profile.name.toLocaleLowerCase("ru").includes(needle))
      .filter((user) => type !== "Сообщество" || communityType === "all" || user.profile.communityType === communityType)
      .sort((first, second) => activity(second) - activity(first) || first.profile.name.localeCompare(second.profile.name, "ru"));
  }, [communityType, events, query, type, users]);
  const community = type === "Сообщество";
  return <main className="content-scroll directory-page publishing-directory-page">
    <div className="directory-heading"><div><h1>{community ? "Книжные сообщества" : "Новинки издательств"}</h1><p>{community ? "Книжные клубы, объединения, их книги, события и новости." : "Познакомьтесь с издательствами! Книги, события и новости издательства — в одном месте."}</p></div><div className={`organization-directory-filters ${community ? "has-community-type" : ""}`}><label className="books-search-field"><span>Поиск по названию</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={community ? "Название сообщества" : "Название издательства"} /></label>{community && <label className="directory-control-field"><span>Тип сообщества</span><CustomSelect ariaLabel="Тип сообщества" value={communityType} onChange={setCommunityType} options={[{ value: "all", label: "Все типы" }, ...communityTypes.map((item) => ({ value: item, label: item }))]} /></label>}</div></div>
    {organizations.length ? <div className="publishing-list">{organizations.map((publisher) => {
      const latestNews = [...(publisher.publisherNews ?? [])].sort((first, second) => Date.parse(second.createdAtValue ?? second.createdAt) - Date.parse(first.createdAtValue ?? first.createdAt))[0];
      const latestEvent = events.filter((item) => item.creatorId === publisher.id && item.status === "published").sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))[0];
      return <article className="publishing-card" key={publisher.id} onClick={() => onOpenUser(publisher.id)}>
        <div className="publishing-card-intro">
          <button className={`avatar avatar-lg avatar-${publisher.color} ${publisher.avatarUrl ? "has-photo" : ""}`} style={publisher.avatarUrl ? { backgroundImage: `url(${publisher.avatarUrl})` } : undefined} type="button" onClick={() => onOpenUser(publisher.id)}>{!publisher.avatarUrl && publisher.initials}</button>
          <div className="publishing-card-copy"><h2>{publisher.profile.name}</h2><p>{publisher.profile.bio || `${community ? "Сообщество" : "Издательство"} пока не добавило описание.`}</p></div>
        </div>
        <div className="publishing-latest-books">{(publisher.authorBooks ?? []).slice(0, 3).map((book) => <div className="publishing-mini-book" key={book.id}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><div><strong>{book.title}</strong><span>{book.author}</span><p>{book.annotation}</p></div></div>)}</div>
        {(latestNews || latestEvent) && <div className="publishing-card-updates">
          <div>{latestNews ? <><span className="section-subtitle">Последняя новость</span><strong>{latestNews.title}</strong><p>{latestNews.previewText}</p></> : <p>Новостей пока нет.</p>}</div>
          <i aria-hidden="true" />
          <div>{latestEvent ? <><span className="section-subtitle">Последнее событие</span><strong>{latestEvent.title}</strong><p>{latestEvent.date} · {latestEvent.city} · {latestEvent.summary}</p></> : <p>Событий пока нет.</p>}</div>
        </div>}
      </article>;
    })}</div> : <div className="profile-tab-placeholder">{query ? "Ничего не найдено." : `Подтверждённых ${community ? "сообществ" : "издательств"} пока нет.`}</div>}
  </main>;
}
