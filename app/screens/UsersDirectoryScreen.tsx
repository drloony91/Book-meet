import { useEffect, useMemo, useState } from "react";
import { CustomSelect } from "../components/common/CustomSelect";
import { CityFilter } from "../components/content/ContentComponents";
import { userBookMatches } from "../lib/domain";
import type { BookEvent, DemoUser, PublicOrganization } from "../types/domain";
import { useI18n } from "../i18n";

export function UsersDirectoryPage({ currentUser, users, onOpenUser }: { currentUser: DemoUser; users: DemoUser[]; onOpenUser: (userId: number) => void }) {
  const { t, domainLabel } = useI18n();
  const [sort, setSort] = useState<"registration" | "matches">("matches");
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [profileType, setProfileType] = useState<"all" | "Читатель" | "Писатель" | "Блогер">("all");
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const publicUsers = useMemo(() => users.filter((user) => !user.isAdmin && !user.deletedAt && !user.purged)
    .filter((user) => ["Читатель", "Писатель", "Блогер"].includes(user.profile.type))
    .filter((user) => Boolean(user.profile.name?.trim()) && Boolean(user.profile.city?.trim() || user.profile.cityId) && Boolean(user.profile.birthDate) && ["Мужской", "Женский"].includes(user.profile.gender) && !user.usernameIsTemporary), [users]);
  const sortedUsers = useMemo(
    () => publicUsers
      .filter((user) => user.id !== currentUser.id)
      .filter((user) => !query.trim() || `${user.profile.name} ${user.username} ${user.profile.bio}`.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")))
      .filter((user) => profileType === "all" || user.profile.type === profileType)
      .filter((user) => !city || user.profile.city.trim().toLocaleLowerCase("ru") === city.trim().toLocaleLowerCase("ru"))
      .map((user) => ({ user, matches: userBookMatches(currentUser, user) }))
      .sort((first, second) => sort === "matches"
        ? second.matches.total - first.matches.total || second.user.id - first.user.id
        : (Date.parse(second.user.joinedAt ?? "") || second.user.id) - (Date.parse(first.user.joinedAt ?? "") || first.user.id)),
    [city, currentUser, profileType, publicUsers, query, sort],
  );
  const cityUsers = publicUsers.filter((user) => user.id !== currentUser.id && user.profile.city.trim().toLocaleLowerCase("ru") === currentUser.profile.city.trim().toLocaleLowerCase("ru")).length;
  useEffect(() => { setPage(1); }, [city, profileType, query, sort]);
  const totalPages = Math.max(1, Math.ceil(sortedUsers.length / pageSize));
  const visibleUsers = sortedUsers.slice((Math.min(page, totalPages) - 1) * pageSize, Math.min(page, totalPages) * pageSize);

  return <main className="content-scroll directory-page">
    <div className="directory-heading">
      <div><span className="section-subtitle">{t("directory.community")}</span><h1>{t("directory.users")}</h1><div className="users-directory-metrics"><p>{t("directory.totalUsers", { count: publicUsers.length })}</p><p>{t("directory.cityUsers", { count: cityUsers })}</p></div></div>
      <div className="directory-controls directory-filter-controls">
        <label className="desktop-directory-search"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("directory.searchPeople")} /></label>
        <label className="directory-control-field"><span>{t("directory.who")}</span><CustomSelect ariaLabel={t("directory.who")} value={profileType} onChange={setProfileType} options={[{ value: "all", label: t("directory.everyone") }, { value: "Читатель", label: domainLabel("Читатель") }, { value: "Писатель", label: domainLabel("Писатель") }, { value: "Блогер", label: domainLabel("Блогер") }]} /></label>
        <div className="directory-control-field"><span>{t("content.city")}</span><CityFilter value={city} cities={publicUsers.filter((user) => user.id !== currentUser.id).map((user) => user.profile.city)} onChange={setCity} /></div>
        <label className="directory-control-field"><span>{t("common.sort")}</span><CustomSelect ariaLabel={t("common.sort")} value={sort} onChange={setSort} options={[{ value: "matches", label: t("directory.bookMatches") }, { value: "registration", label: t("directory.registration") }]} /></label>
      </div>
    </div>
    <div className="users-directory-grid">{visibleUsers.map(({ user, matches }) => <article className="directory-user-card material-clickable-card" role="button" tabIndex={0} key={user.id} onClick={() => onOpenUser(user.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenUser(user.id); } }}>
      <span className={`avatar avatar-lg avatar-${user.color} ${user.avatarUrl ? "has-photo" : ""}`} style={user.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}>{!user.avatarUrl && user.initials}{user.online && <span className="online-dot" />}</span>
      <div><span>{domainLabel(user.profile.type)}{user.profile.city ? <span data-i18n-skip> · {user.profile.city}</span> : ""}</span><h2 data-i18n-skip>{user.profile.name}</h2><p data-i18n-skip={Boolean(user.profile.bio)}>{user.profile.bio || t("directory.userBioEmpty")}</p></div>
      <div className="user-match-summary"><strong>{matches.total}</strong><span>{t("directory.matches")}</span></div>
    </article>)}</div>{totalPages > 1 && <nav className="directory-pagination" aria-label="Страницы"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>←</button><span>{page} / {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>→</button></nav>}
  </main>;
}

export function PublishingDirectoryPage({ users, events, onOpenUser }: { users: DemoUser[]; events: BookEvent[]; onOpenUser: (userId: number) => void }) {
  return <OrganizationDirectoryPage type="Издатель" users={users} events={events} onOpenUser={onOpenUser} />;
}

export function CommunitiesDirectoryPage({ users, events, onOpenUser }: { users: DemoUser[]; events: BookEvent[]; onOpenUser: (userId: number) => void }) {
  return <OrganizationDirectoryPage type="Сообщество" users={users} events={events} onOpenUser={onOpenUser} />;
}

export function PublicOrganizationDirectoryPage({ type, organizations, onOpen }: { type: "Издатель" | "Сообщество"; organizations: PublicOrganization[]; onOpen: () => void }) {
  const { t, domainLabel } = useI18n();
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
    <div className="directory-heading"><div><h1>{community ? t("nav.communities") : t("nav.publishing")}</h1><p>{community ? t("directory.communityIntro") : t("directory.publisherIntro")}</p></div><div className={`organization-directory-filters ${community ? "has-community-type" : ""}`}><label className="books-search-field"><span>{t("directory.searchName")}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={community ? t("directory.communityName") : t("directory.publisherName")} /></label>{community && <label className="directory-control-field"><span>{t("directory.communityType")}</span><CustomSelect ariaLabel={t("directory.communityType")} value={communityType} onChange={setCommunityType} options={[{ value: "all", label: t("directory.allTypes") }, ...communityTypes.map((item) => ({ value: item, label: item }))]} /></label>}</div></div>
    {visible.length ? <div className="publishing-list">{visible.map((organization) => <article className="publishing-card material-clickable-card" role="button" tabIndex={0} key={organization.id} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}><div className="publishing-card-intro"><span className={`avatar avatar-lg avatar-${organization.color} ${organization.avatarUrl ? "has-photo" : ""}`} style={organization.avatarUrl ? { backgroundImage: `url(${organization.avatarUrl})` } : undefined}>{!organization.avatarUrl && organization.initials}</span><div className="publishing-card-copy"><span className="section-subtitle">{domainLabel(organization.type)}<span data-i18n-skip>{organization.communityType ? ` · ${organization.communityType}` : ""}{organization.city ? ` · ${organization.city}` : ""}</span></span><h2 data-i18n-skip>{organization.name}</h2><p data-i18n-skip={Boolean(organization.bio)}>{organization.bio || t("directory.descriptionEmpty", { organization: domainLabel(type) })}</p></div></div></article>)}</div> : <div className="profile-tab-placeholder">{query ? t("common.nothingFound") : t("directory.approvedEmpty", { organizations: domainLabel(type) })}</div>}
  </main>;
}

function OrganizationDirectoryPage({ type, users, events, onOpenUser }: { type: "Издатель" | "Сообщество"; users: DemoUser[]; events: BookEvent[]; onOpenUser: (userId: number) => void }) {
  const { t, domainLabel } = useI18n();
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
    <div className="directory-heading"><div><h1>{community ? t("nav.communities") : t("nav.publishing")}</h1><p>{community ? t("directory.communityIntro") : t("directory.publisherIntro")}</p></div><div className={`organization-directory-filters ${community ? "has-community-type" : ""}`}><label className="books-search-field"><span>{t("directory.searchName")}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={community ? t("directory.communityName") : t("directory.publisherName")} /></label>{community && <label className="directory-control-field"><span>{t("directory.communityType")}</span><CustomSelect ariaLabel={t("directory.communityType")} value={communityType} onChange={setCommunityType} options={[{ value: "all", label: t("directory.allTypes") }, ...communityTypes.map((item) => ({ value: item, label: item }))]} /></label>}</div></div>
    {organizations.length ? <div className="publishing-list">{organizations.map((publisher) => {
      const latestNews = [...(publisher.publisherNews ?? [])].sort((first, second) => Date.parse(second.createdAtValue ?? second.createdAt) - Date.parse(first.createdAtValue ?? first.createdAt))[0];
      const latestEvent = events.filter((item) => item.creatorId === publisher.id && item.status === "published").sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))[0];
      return <article className="publishing-card" key={publisher.id} onClick={() => onOpenUser(publisher.id)}>
        <div className="publishing-card-intro">
          <button className={`avatar avatar-lg avatar-${publisher.color} ${publisher.avatarUrl ? "has-photo" : ""}`} style={publisher.avatarUrl ? { backgroundImage: `url(${publisher.avatarUrl})` } : undefined} type="button" onClick={() => onOpenUser(publisher.id)}>{!publisher.avatarUrl && publisher.initials}</button>
          <div className="publishing-card-copy"><h2 data-i18n-skip>{publisher.profile.name}</h2><p data-i18n-skip={Boolean(publisher.profile.bio)}>{publisher.profile.bio || t("directory.descriptionEmpty", { organization: domainLabel(type) })}</p></div>
        </div>
        <div className="publishing-latest-books">{(publisher.authorBooks ?? []).slice(0, 3).map((book) => <div className="publishing-mini-book" key={book.id}><div className={`library-book-cover library-cover-${book.coverTone}`} style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}>{!book.coverUrl && <><em>{book.author}</em><strong>{book.title}</strong><span>Book Meet</span></>}</div><div><strong>{book.title}</strong><span>{book.author}</span><p>{book.annotation}</p></div></div>)}</div>
        {(latestNews || latestEvent) && <div className="publishing-card-updates">
          <div>{latestNews ? <><span className="section-subtitle">{t("directory.latestNews")}</span><strong data-i18n-skip>{latestNews.title}</strong><p data-i18n-skip>{latestNews.previewText}</p></> : <p>{t("directory.noNews")}</p>}</div>
          <i aria-hidden="true" />
          <div>{latestEvent ? <><span className="section-subtitle">{t("directory.latestEvent")}</span><strong data-i18n-skip>{latestEvent.title}</strong><p data-i18n-skip>{latestEvent.date} · {latestEvent.city} · {latestEvent.summary}</p></> : <p>{t("directory.noEvents")}</p>}</div>
        </div>}
      </article>;
    })}</div> : <div className="profile-tab-placeholder">{query ? t("common.nothingFound") : t("directory.approvedEmpty", { organizations: domainLabel(type) })}</div>}
  </main>;
}
