import { useEffect, useRef, useState } from "react";
import { useI18n, type Locale } from ".";

const options: Array<{ locale: Locale; short: string; key: "locale.ru" | "locale.kk" | "locale.en" }> = [
  { locale: "kk", short: "KZ", key: "locale.kk" },
  { locale: "ru", short: "RU", key: "locale.ru" },
  { locale: "en", short: "EN", key: "locale.en" },
];

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.locale === locale)!;
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); window.removeEventListener("keydown", closeEscape); };
  }, [open]);
  return <div className={`locale-switcher ${compact ? "is-compact" : ""}`} ref={root}>
    <button className="locale-switcher-toggle" type="button" aria-label={t("locale.label")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{selected.short}</button>
    {open && <div className="locale-switcher-menu" role="menu">{options.map((option) => <button type="button" role="menuitemradio" aria-checked={locale === option.locale} className={locale === option.locale ? "is-selected" : ""} key={option.locale} onClick={() => { setLocale(option.locale); setOpen(false); }}><span>{option.short}</span>{t(option.key)}</button>)}</div>}
  </div>;
}

export function AuthLocaleRow() {
  const { locale, setLocale, t } = useI18n();
  return <div className="auth-locale-row" aria-label={t("locale.label")}>{options.map((option, index) => <span key={option.locale}>{index > 0 && <i aria-hidden="true">|</i>}<button type="button" className={locale === option.locale ? "is-selected" : ""} aria-pressed={locale === option.locale} onClick={() => setLocale(option.locale)}>{t(option.key)}</button></span>)}</div>;
}
