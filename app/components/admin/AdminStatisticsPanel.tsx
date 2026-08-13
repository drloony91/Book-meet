import { useI18n } from "../../i18n";
import type { AdminStatistics } from "../../types/domain";

export function AdminStatisticsPanel({ statistics }: { statistics: AdminStatistics | null }) {
  const { t, domainLabel, formatNumber } = useI18n();
  const userTypes = [
    [domainLabel("Читатель"), statistics?.usersByType["Читатель"] ?? 0],
    [domainLabel("Писатель"), statistics?.usersByType["Писатель"] ?? 0],
    [domainLabel("Блогер"), statistics?.usersByType["Блогер"] ?? 0],
    [domainLabel("Издатель"), statistics?.usersByType["Издатель"] ?? 0],
    [domainLabel("Сообщество"), statistics?.usersByType["Сообщество"] ?? 0],
  ] as const;
  const materials = [
    [t("admin.books"), statistics?.books ?? 0],
    [t("content.reviews"), statistics?.reviews ?? 0],
    [t("content.publications"), statistics?.publications ?? 0],
    [t("content.events"), statistics?.events ?? 0],
    [t("content.occasionsShort"), statistics?.occasions ?? 0],
  ] as const;
  const community = [
    [t("admin.wishlistBooks"), statistics?.wishlistBooks ?? 0],
    [t("admin.reservedGifts"), statistics?.reservedGifts ?? 0],
    [t("admin.usersWithFriends"), statistics?.friendshipUsers ?? 0],
  ] as const;
  const metric = (value: number) => statistics ? formatNumber(value) : "—";

  return (
    <section className={`admin-statistics-panel${statistics ? "" : " is-loading"}`}>
      <div className="admin-statistics-heading">
        <div><span className="section-subtitle">{t("admin.overview")}</span><h2>{t("admin.communityStatistics")}</h2></div>
        <div className="admin-statistics-total"><strong>{statistics ? formatNumber(statistics.totalUsers) : "—"}</strong><span>{t("admin.users")}</span></div>
      </div>
      <div className="admin-statistics-user-types">
        {userTypes.map(([label, count]) => <article key={label}><strong>{metric(count)}</strong><span>{label}</span></article>)}
      </div>
      <div className="admin-statistics-block">
        <h3>{t("admin.cities")}</h3>
        <div className="admin-statistics-cities">
          {statistics?.cities.length
            ? statistics.cities.map(({ city, count }) => <span key={city} data-i18n-skip>{city}<b>{formatNumber(count)}</b></span>)
            : <p>{statistics ? t("admin.noCities") : t("admin.collectingData")}</p>}
        </div>
      </div>
      <div className="admin-statistics-block">
        <h3>{t("admin.materials")}</h3>
        <div className="admin-statistics-metrics">
          {materials.map(([label, count]) => <article key={label}><strong>{metric(count)}</strong><span>{label}</span></article>)}
        </div>
      </div>
      <div className="admin-statistics-extras">
        {community.map(([label, count]) => <article key={label}><strong>{metric(count)}</strong><span>{label}</span></article>)}
      </div>
    </section>
  );
}
