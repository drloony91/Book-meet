"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch } from "../services/api";
import type { AuthResult } from "../types/domain";
import { localizedApiError, useI18n } from "../i18n";
import { AuthLocaleRow } from "../i18n/LocaleSwitcher";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (element: HTMLElement, options: Record<string, string | number>) => void;
        };
      };
    };
  }
}

export function LoginScreen({ onLogin, onRegister, initialError = "" }: { onLogin: (email: string, password: string, totp?: string) => Promise<AuthResult>; onRegister: (value: { email: string; password: string }) => Promise<AuthResult>; initialError?: string }) {
  const { locale, t } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [turning, setTurning] = useState<"to-register" | "to-login" | null>(null);
  const turnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [providers, setProviders] = useState({ google: false, googleClientId: "" });
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);
  const [accountAction, setAccountAction] = useState<"none" | "recovery" | "reset" | "verification">("none");
  const [actionNotice, setActionNotice] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const googleButtonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch(`/api/auth/providers?v=${Date.now()}`, { cache: "no-store" }).then((response) => response.json()).then((value) => setProviders(value)).catch(() => undefined);
    return () => {
      if (turnTimer.current) clearTimeout(turnTimer.current);
    };
  }, []);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const reset = parameters.get("reset");
    const verify = parameters.get("verify");
    if (reset) {
      setResetToken(reset);
      setAccountAction("reset");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    if (!verify) return;
    setAccountAction("verification");
    window.history.replaceState({}, "", window.location.pathname);
    void apiFetch("/api/auth/email-verification/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: verify }) })
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as { error?: string };
        setActionNotice(response.ok ? t("auth.verificationSuccess") : localizedApiError(result.error, t("auth.verificationError")));
      })
      .catch(() => setActionNotice(t("auth.verificationError")));
  }, []);

  useEffect(() => {
    if (!providers.google || !providers.googleClientId || !googleButtonRef.current) return;
    let active = true;

    const renderGoogleButton = () => {
      if (!active || !window.google || !googleButtonRef.current) return;
      googleButtonRef.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: providers.googleClientId,
        callback: async ({ credential }) => {
          setSubmitting(true);
          setError("");
          try {
            let lastError = t("auth.googleFinishError");
            for (let attempt = 0; attempt < 2; attempt += 1) {
              if (attempt) await new Promise((resolve) => window.setTimeout(resolve, 900));
              let response: Response;
              try {
                const controller = new AbortController();
                const timeout = window.setTimeout(() => controller.abort(), 15_000);
                response = await apiFetch("/api/auth/google/credential", {
                  method: "POST",
                  credentials: "same-origin",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ credential }),
                  signal: controller.signal,
                }).finally(() => window.clearTimeout(timeout));
              } catch (requestError) {
                lastError = requestError instanceof Error && requestError.name !== "AbortError"
                  ? requestError.message
                  : t("auth.googleSlow");
                if (attempt === 1) throw new Error(lastError);
                continue;
              }
              const result = await response.json() as { error?: string; registered?: boolean; retryable?: boolean };
              if (response.ok) {
                window.location.assign(`/?auth=success&registered=${result.registered ? "1" : "0"}`);
                return;
              }
              lastError = localizedApiError(result.error, lastError);
              if (!result.retryable || attempt === 1) throw new Error(lastError);
            }
          } catch (googleError) {
            setError(googleError instanceof Error ? googleError.message : t("auth.googleFinishError"));
            setSubmitting(false);
          }
        },
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        shape: "rectangular",
        text: mode === "login" ? "signin_with" : "signup_with",
        width: 260,
        locale,
      });
    };

    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (window.google) renderGoogleButton();
    else if (existingScript) existingScript.addEventListener("load", renderGoogleButton, { once: true });
    else {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", renderGoogleButton, { once: true });
      script.addEventListener("error", () => active && setError(t("auth.googleLoadError")), { once: true });
      document.head.appendChild(script);
    }
    return () => { active = false; };
  }, [locale, mode, providers.google, providers.googleClientId]);

  function changeMode(nextMode: "login" | "register") {
    if (nextMode === mode || turning) return;
    setTurning(nextMode === "register" ? "to-register" : "to-login");
    setMode(nextMode);
    setError("");
    setTotp("");
    setTotpRequired(false);
    turnTimer.current = setTimeout(() => {
      setTurning(null);
      turnTimer.current = null;
    }, 1150);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const result = mode === "login" ? await onLogin(email, password, totp) : await onRegister({ email, password });
    if (result.requiresTotp) setTotpRequired(true);
    if (result.error) setError(localizedApiError(result.error, mode === "login" ? t("auth.loginError") : t("auth.createProfileError")));
    setSubmitting(false);
  }

  async function requestPasswordRecovery(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setActionNotice("");
    try {
      const response = await apiFetch("/api/auth/password-reset/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      setActionNotice(result.message || t("auth.recoverySent"));
    } catch {
      setActionNotice(t("auth.requestError"));
    } finally { setSubmitting(false); }
  }

  async function saveResetPassword(event: FormEvent) {
    event.preventDefault();
    if (resetPassword.length < 8 || resetPassword !== resetConfirmation) {
      setActionNotice(t("auth.passwordMismatch"));
      return;
    }
    setSubmitting(true);
    setActionNotice("");
    try {
      const response = await apiFetch("/api/auth/password-reset/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: resetToken, password: resetPassword }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setActionNotice(localizedApiError(result.error, t("auth.passwordSaveError"))); return; }
      setResetToken(""); setResetPassword(""); setResetConfirmation(""); setAccountAction("none"); setError(t("auth.passwordSaved"));
    } catch { setActionNotice(t("auth.passwordSaveError")); }
    finally { setSubmitting(false); }
  }

  const visibleMode = mode;

  if (accountAction !== "none") return <main className="login-page"><section className="login-book account-action-book"><div className="login-book-spread"><article className="login-book-page"><div className="auth-form-page account-action-form"><img className="login-brand-logo" src="/book-meet-header-logo-v3.png" alt="Book Meet" />
    {accountAction === "recovery" && <><h1>{t("auth.recover")}</h1><p>{t("auth.recoveryHint")}</p><form onSubmit={requestPasswordRecovery}><label>E-mail<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>{actionNotice && <span className="login-error account-action-notice">{actionNotice}</span>}<button className="primary-button" type="submit" disabled={submitting}>{submitting ? t("auth.sending") : t("auth.sendLink")}</button></form></>}
    {accountAction === "reset" && <><h1>{t("auth.newPassword")}</h1><p>{t("auth.resetHint")}</p><form onSubmit={saveResetPassword}><label>{t("auth.newPassword")}<input required minLength={8} type="password" autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></label><label>{t("auth.repeatPassword")}<input required minLength={8} type="password" autoComplete="new-password" value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} /></label>{actionNotice && <span className="login-error account-action-notice">{actionNotice}</span>}<button className="primary-button" type="submit" disabled={submitting}>{submitting ? t("auth.saving") : t("auth.savePassword")}</button></form></>}
    {accountAction === "verification" && <><h1>{t("auth.emailVerification")}</h1><p>{actionNotice || t("auth.checkingLink")}</p></>}
    <button className="outline-button auth-switch-button" type="button" onClick={() => { setAccountAction("none"); setActionNotice(""); }}>{t("auth.backToLogin")}</button>
  </div></article></div></section></main>;

  function authForm(formMode: "login" | "register") {
    return <div className="auth-form-page">
      <img className="login-brand-logo" src="/book-meet-header-logo-v3.png" alt="Book Meet" />
      <h1>{formMode === "login" ? t("auth.welcomeBack") : t("auth.welcome")}</h1>
      <p>{formMode === "login" ? t("auth.loginHint") : t("auth.registerHint")}</p>
      <form onSubmit={submit}>
        <label>E-mail<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        <label>{t("auth.password")}<input required minLength={8} type="password" autoComplete={formMode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("auth.passwordPlaceholder")} /></label>
        {formMode === "login" && totpRequired && <label>{t("auth.totp")}<input required autoComplete="one-time-code" maxLength={19} value={totp} onChange={(event) => setTotp(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 19))} placeholder="000000 / BM-XXXX-XXXX-XXXX" /></label>}
        {error && <span className="login-error">{error}</span>}
        <button className="primary-button" type="submit" disabled={submitting}>{submitting ? t("auth.checking") : formMode === "login" ? t("auth.login") : t("auth.createProfile")}</button>
      </form>
      <div className="auth-provider-actions">
        {providers.google ? <div className="google-provider-button" ref={googleButtonRef} /> : <span>{t("auth.googleUnavailable")}</span>}
      </div>
      {formMode === "login" && <button className="auth-recovery-link" type="button" onClick={() => { setAccountAction("recovery"); setActionNotice(""); }}>{t("auth.recover")}</button>}
      <AuthLocaleRow />
      <div className="mobile-auth-invitation">
        <h2>{formMode === "login" ? t("auth.firstTime") : t("auth.hasProfile")}</h2>
        <button className="outline-button auth-switch-button" type="button" onClick={() => changeMode(formMode === "login" ? "register" : "login")}>{formMode === "login" ? t("auth.register") : t("auth.login")}</button>
      </div>
    </div>;
  }

  function invitation(kind: "new" | "returning", decorative = false) {
    return <div className="auth-book-invitation">
      <h2>{kind === "new" ? t("auth.firstTime") : t("auth.hasProfile")}</h2>
      {decorative
        ? <span className="outline-button auth-switch-button auth-switch-placeholder">{kind === "new" ? t("auth.createProfile") : t("auth.loginProfile")}</span>
        : <button className="outline-button auth-switch-button" type="button" onClick={() => changeMode(kind === "new" ? "register" : "login")}>{kind === "new" ? t("auth.createProfile") : t("auth.loginProfile")}</button>}
    </div>;
  }

  return (
    <main className="login-page">
      <section className={`login-book mode-${visibleMode} ${turning ? `is-turning ${turning}` : ""}`} aria-label={visibleMode === "login" ? t("auth.loginAria") : t("auth.registerAria")}>
        <div className="login-book-cover" aria-hidden="true" />
        <div className="login-book-spread">
          <article className="login-book-page login-book-page-left">{visibleMode === "login" ? authForm("login") : invitation("returning")}</article>
          <article className="login-book-page login-book-page-right">{visibleMode === "register" ? authForm("register") : invitation("new")}</article>
          <span className="login-book-gutter" aria-hidden="true" />
          {turning && <div className={`login-turning-page ${turning}`} aria-hidden="true">
            <div className="login-turning-face login-turning-front">{invitation(turning === "to-register" ? "new" : "returning", true)}</div>
            <div className="login-turning-face login-turning-back">{invitation(turning === "to-register" ? "returning" : "new", true)}</div>
          </div>}
        </div>
      </section>
    </main>
  );
}

export function AuthBookTransition() {
  const { t } = useI18n();
  return <main className="auth-transition-page" aria-live="polite">
    <p className="loading-copy loading-copy-top">{t("common.loading")}</p>
    <img className="auth-book-gif" src="/book-loading.gif" alt="" aria-hidden="true" />
    <p className="loading-copy loading-copy-bottom">{t("common.moreLoading")}</p>
  </main>;
}
