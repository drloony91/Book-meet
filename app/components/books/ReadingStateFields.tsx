import { useState, type ChangeEvent } from "react";
import { useI18n } from "../../i18n";
import type { LibraryBook, ReadingStatus } from "../../types/domain";
import { CustomSelect } from "../common/CustomSelect";

export const readingStatuses: ReadingStatus[] = ["want", "reading", "read", "abandoned", "postponed"];

const labels: Record<ReadingStatus, Record<"ru" | "kk" | "en", string>> = {
  want: { ru: "Хочу прочитать", kk: "Оқығым келеді", en: "Want to read" },
  reading: { ru: "Читаю", kk: "Оқып жатырмын", en: "Reading" },
  read: { ru: "Прочитано", kk: "Оқылды", en: "Read" },
  abandoned: { ru: "Брошено", kk: "Аяқталмаған", en: "Abandoned" },
  postponed: { ru: "Отложено", kk: "Кейінге қалдырылды", en: "Postponed" },
};

const UINT32_MAX = 4_294_967_295;

// Keep a typed invalid number in the draft.  Coercing it to undefined would
// serialize as a clear and could erase a valid value before client validation
// has a chance to reject the edit.  Only an empty control means "clear".
function progressInput(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}

function validCurrent(value: number | null | undefined) {
  return value == null || (Number.isInteger(value) && value >= 0 && value <= UINT32_MAX);
}

function validTotal(value: number | null | undefined) {
  return value == null || (Number.isInteger(value) && value > 0 && value <= UINT32_MAX);
}

export function readingProgressIsValid(book: Pick<LibraryBook, "chaptersCurrent" | "chaptersTotal" | "pagesCurrent" | "pagesTotal">) {
  const pairIsValid = (current: number | null | undefined, total: number | null | undefined) => validCurrent(current) && validTotal(total) && (current == null || total == null || current <= total);
  return pairIsValid(book.chaptersCurrent, book.chaptersTotal) && pairIsValid(book.pagesCurrent, book.pagesTotal);
}

export function readingStatusLabel(status: ReadingStatus, locale: "ru" | "kk" | "en") {
  return labels[status][locale];
}

export function ReadingStatusSelector({ value, onChange }: { value: ReadingStatus; onChange: (status: ReadingStatus) => void }) {
  const { locale, t } = useI18n();
  return <div className="reading-status-select"><span>{t("library.bookStatus")}</span><CustomSelect ariaLabel={t("library.bookStatus")} value={value} onChange={onChange} options={readingStatuses.map((status) => ({ value: status, label: readingStatusLabel(status, locale) }))} /></div>;
}

/**
 * The same controlled fields are used by the complete editor and the status
 * dialog.  It intentionally retains both units: switching the display tab is
 * not itself a progress mutation.
 */
export function ReadingStateFields({ value, onChange, includeStatus = false }: { value: LibraryBook; onChange: (next: LibraryBook) => void; includeStatus?: boolean }) {
  const { locale, t } = useI18n();
  const status = value.readingStatus ?? "read";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const currentYear = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" }).format(new Date()));
  const changeStatus = (readingStatus: ReadingStatus) => onChange(readingStatus === "read" && status !== "read" ? { ...value, readingStatus, rating: 0, review: "", readMonth: undefined, readYear: undefined } : { ...value, readingStatus });
  const [shownUnit, setShownUnit] = useState<"chapters" | "pages">(value.progressUnit ?? "chapters");
  const updatePair = (key: "chaptersCurrent" | "chaptersTotal" | "pagesCurrent" | "pagesTotal") => (event: ChangeEvent<HTMLInputElement>) => {
    const next = progressInput(event.target.value);
    const unit: "chapters" | "pages" = key.startsWith("chapters") ? "chapters" : "pages";
    const changed = { ...value, [key]: next, progressUnit: unit, progressPercent: undefined };
    onChange(changed);
  };
  if (status === "want") return includeStatus ? <ReadingStatusSelector value={status} onChange={changeStatus} /> : null;
  return <div className={`reading-state-fields ${status === "postponed" && value.postponedOverdue ? "postponed-overdue-fields" : ""}`}>
    {includeStatus && <ReadingStatusSelector value={status} onChange={changeStatus} />}
    {status === "reading" && <>
      <fieldset><legend className="visually-hidden">{locale === "ru" ? "Прогресс" : locale === "kk" ? "Прогресс" : "Progress"}</legend>
        <div className="reading-unit-tabs" role="group" aria-label={locale === "ru" ? "Единица прогресса" : locale === "kk" ? "Прогресс бірлігі" : "Progress unit"}><button type="button" aria-pressed={shownUnit === "chapters"} className={shownUnit === "chapters" ? "active" : ""} onClick={() => setShownUnit("chapters")}>{locale === "ru" ? "Главы" : locale === "kk" ? "Тараулар" : "Chapters"}</button><button type="button" aria-pressed={shownUnit === "pages"} className={shownUnit === "pages" ? "active" : ""} onClick={() => setShownUnit("pages")}>{locale === "ru" ? "Страницы" : locale === "kk" ? "Беттер" : "Pages"}</button></div>
        {shownUnit === "chapters" ? <div className="form-row"><label>{locale === "ru" ? "Главы: прочитано" : locale === "kk" ? "Тараулар: оқылған" : "Chapters: current"}<input title={t("library.chaptersRead")} min={0} max={UINT32_MAX} step={1} inputMode="numeric" type="number" value={value.chaptersCurrent ?? ""} onChange={updatePair("chaptersCurrent")} /></label><label>{locale === "ru" ? "Главы: всего" : locale === "kk" ? "Тараулар: барлығы" : "Chapters: total"}<input min={1} max={UINT32_MAX} step={1} inputMode="numeric" type="number" value={value.chaptersTotal ?? ""} onChange={updatePair("chaptersTotal")} /></label></div> : <div className="form-row"><label>{locale === "ru" ? "Страницы: прочитано" : locale === "kk" ? "Беттер: оқылған" : "Pages: current"}<input min={0} max={UINT32_MAX} step={1} inputMode="numeric" type="number" value={value.pagesCurrent ?? ""} onChange={updatePair("pagesCurrent")} /></label><label>{locale === "ru" ? "Страницы: всего" : locale === "kk" ? "Беттер: барлығы" : "Pages: total"}<input min={1} max={UINT32_MAX} step={1} inputMode="numeric" type="number" value={value.pagesTotal ?? ""} onChange={updatePair("pagesTotal")} /></label></div>}
      </fieldset>
      {!readingProgressIsValid(value) && <p className="form-error" role="alert">{locale === "ru" ? "Укажите целые значения: прочитано не больше общего." : locale === "kk" ? "Бүтін мәндерді көрсетіңіз: оқылғаны жалпыдан аспасын." : "Use whole values; current cannot exceed total."}</p>}
      <label>{locale === "ru" ? "Мысли, цитаты, впечатления" : locale === "kk" ? "Ойлар, дәйексөздер, әсерлер" : "Thoughts, quotes, impressions"}<textarea rows={3} value={value.readingComment ?? ""} onChange={(event) => onChange({ ...value, readingComment: event.target.value })} /></label>
    </>}
    {status === "read" && <><label>{t("content.rating")} *<input required min={0.5} max={5} step={0.5} type="number" value={value.rating || ""} onChange={(event) => onChange({ ...value, rating: Number(event.target.value) })} /></label><label>{t("library.shortReview")} *<textarea required rows={3} value={value.review ?? ""} onChange={(event) => onChange({ ...value, review: event.target.value })} /></label><div className="form-row"><label>{t("library.month")} *<input required min={1} max={12} step={1} type="number" value={value.readMonth ?? ""} onChange={(event) => onChange({ ...value, readMonth: progressInput(event.target.value) })} /></label><label>{t("library.year")} *<input required min={1900} max={currentYear} step={1} type="number" value={value.readYear ?? ""} onChange={(event) => onChange({ ...value, readYear: progressInput(event.target.value) })} /></label></div></>}
    {status === "abandoned" && <label>{t("library.shortReview")}<textarea rows={3} value={value.review ?? ""} onChange={(event) => onChange({ ...value, review: event.target.value })} /></label>}
    {status === "postponed" && <><label>{locale === "ru" ? "Комментарий" : locale === "kk" ? "Пікір" : "Comment"}<textarea rows={3} value={value.readingComment ?? ""} onChange={(event) => onChange({ ...value, readingComment: event.target.value })} /></label><div className="form-row"><label>{t("library.month")}<input min={1} max={12} step={1} type="number" value={value.postponedMonth ?? ""} onChange={(event) => onChange({ ...value, postponedMonth: progressInput(event.target.value) })} /></label><label>{t("library.year")}<input min={1900} max={2100} step={1} type="number" value={value.postponedYear ?? ""} onChange={(event) => onChange({ ...value, postponedYear: progressInput(event.target.value) })} /></label></div></>}
  </div>;
}
