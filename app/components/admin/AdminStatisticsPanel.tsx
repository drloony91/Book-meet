import type { AdminStatistics } from "../../types/domain";

export function AdminStatisticsPanel({ statistics }: { statistics: AdminStatistics | null }) {
  const userTypes = [
    ["Читатели", statistics?.usersByType["Читатель"] ?? 0],
    ["Писатели", statistics?.usersByType["Писатель"] ?? 0],
    ["Блогеры", statistics?.usersByType["Блогер"] ?? 0],
    ["Издатели", statistics?.usersByType["Издатель"] ?? 0],
    ["Сообщества", statistics?.usersByType["Сообщество"] ?? 0],
  ] as const;
  const materials = [
    ["Книги", statistics?.books ?? 0],
    ["Рецензии", statistics?.reviews ?? 0],
    ["Публикации", statistics?.publications ?? 0],
    ["События", statistics?.events ?? 0],
    ["Поводы", statistics?.occasions ?? 0],
  ] as const;
  const community = [
    ["В «Хочу почитать!»", statistics?.wishlistBooks ?? 0],
    ["Забронировано подарков", statistics?.reservedGifts ?? 0],
    ["Пользователей с друзьями", statistics?.friendshipUsers ?? 0],
  ] as const;

  return (
    <section className={`admin-statistics-panel${statistics ? "" : " is-loading"}`}>
      <div className="admin-statistics-heading">
        <div><span className="section-subtitle">Общая картина</span><h2>Статистика сообщества</h2></div>
        <div className="admin-statistics-total"><strong>{statistics?.totalUsers ?? "—"}</strong><span>пользователей</span></div>
      </div>
      <div className="admin-statistics-user-types">
        {userTypes.map(([label, count]) => <article key={label}><strong>{statistics ? count : "—"}</strong><span>{label}</span></article>)}
      </div>
      <div className="admin-statistics-block">
        <h3>Города</h3>
        <div className="admin-statistics-cities">
          {statistics?.cities.length
            ? statistics.cities.map(({ city, count }) => <span key={city}>{city}<b>{count}</b></span>)
            : <p>{statistics ? "Города пока не указаны" : "Собираем данные…"}</p>}
        </div>
      </div>
      <div className="admin-statistics-block">
        <h3>Материалы</h3>
        <div className="admin-statistics-metrics">
          {materials.map(([label, count]) => <article key={label}><strong>{statistics ? count : "—"}</strong><span>{label}</span></article>)}
        </div>
      </div>
      <div className="admin-statistics-extras">
        {community.map(([label, count]) => <article key={label}><strong>{statistics ? count : "—"}</strong><span>{label}</span></article>)}
      </div>
    </section>
  );
}
