/**
 * Production-mode login (docs/05.4): tenant slug + email + password,
 * accessible validation, loading state, and only uiMessage errors.
 */
import { useState } from "react";

interface Props {
  onLogin: (input: { tenantSlug: string; email: string; password: string }) => Promise<void>;
}

export function LoginScreen({ onLogin }: Props) {
  const [tenantSlug, setTenantSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (tenantSlug.trim().length === 0) {
      next.tenantSlug = "Enter your workspace name.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = "Enter a valid email address.";
    }
    if (password.length === 0) {
      next.password = "Enter your password.";
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!validate() || busy) {
      return;
    }
    setBusy(true);
    try {
      await onLogin({
        tenantSlug: tenantSlug.trim(),
        email: email.trim(),
        password,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1.5 w-full rounded-xl border border-control-border bg-command-surface px-3.5 py-3 text-sm text-text-primary outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15 disabled:opacity-60";

  return (
    <main className="grid min-h-screen bg-command-bg text-text-primary lg:grid-cols-[1.08fr_0.92fr]">
      <section className="relative hidden overflow-hidden bg-[#171816] p-12 text-[#F7F1E5] lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, #EF842F 0, transparent 32%), radial-gradient(circle at 78% 65%, #EF842F 0, transparent 26%)",
          }}
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-primary text-[#171816]">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M6 18c0-6 12-6 12-12" strokeLinecap="round" />
              <circle cx="6" cy="18" r="2" fill="currentColor" stroke="none" />
              <circle cx="18" cy="6" r="2" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span className="text-[22px] font-semibold tracking-[-0.03em]">PrivateFleet</span>
        </div>

        <div className="relative max-w-xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#EF842F]">
            Fleet operations, composed
          </p>
          <h1 className="mt-5 text-[56px] font-semibold leading-[0.98] tracking-[-0.05em]">
            Every parcel.
            <br />
            Every route.
            <br />
            <span className="text-[#EF842F]">In view.</span>
          </h1>
          <p className="mt-6 max-w-md text-[14px] leading-relaxed text-[#BDB6A8]">
            Dispatch, optimise and track your fleet from one calm command surface -
            designed for the people moving things in the real world.
          </p>

          <div className="mt-10 flex items-center gap-8 border-t border-white/10 pt-6">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-[#8E877A]">Workload</p>
              <p className="mt-1 text-2xl font-semibold">100 / 850</p>
              <p className="text-[10px] text-[#8E877A]">vehicles / jobs</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-[#8E877A]">Read latency</p>
              <p className="mt-1 text-2xl font-semibold">p95 133 ms</p>
              <p className="text-[10px] text-[#8E877A]">at 20 req/s</p>
            </div>
          </div>
        </div>

        <div className="relative flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-[#8E877A]">
          <span>LAN deployment 192.168.1.128</span>
          <span>Private by design</span>
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <form
          onSubmit={(event) => void submit(event)}
          noValidate
          className="w-full max-w-[390px]"
        >
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-primary text-command-surface">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M6 18c0-6 12-6 12-12" strokeLinecap="round" />
                <circle cx="6" cy="18" r="2" fill="currentColor" stroke="none" />
                <circle cx="18" cy="6" r="2" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span className="text-xl font-semibold tracking-[-0.03em]">PrivateFleet</span>
          </div>

          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-ink">
            Dispatch workspace
          </p>
          <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-[-0.035em]">
            Sign in to dispatch
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
            Use the workspace, email and password issued to your team.
          </p>

          <label className="mt-7 block text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary" htmlFor="tenantSlug">
            Workspace
          </label>
          <input
            id="tenantSlug"
            name="tenantSlug"
            type="text"
            autoComplete="organization"
            value={tenantSlug}
            onChange={(event) => setTenantSlug(event.target.value)}
            aria-invalid={fieldErrors.tenantSlug ? true : undefined}
            aria-describedby={fieldErrors.tenantSlug ? "tenantSlug-error" : undefined}
            disabled={busy}
            className={inputClass}
          />
          {fieldErrors.tenantSlug && (
            <p id="tenantSlug-error" className="mt-1.5 text-xs text-status-warning">
              {fieldErrors.tenantSlug}
            </p>
          )}

          <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
            disabled={busy}
            className={inputClass}
          />
          {fieldErrors.email && (
            <p id="email-error" className="mt-1.5 text-xs text-status-warning">
              {fieldErrors.email}
            </p>
          )}

          <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
            disabled={busy}
            className={inputClass}
          />
          {fieldErrors.password && (
            <p id="password-error" className="mt-1.5 text-xs text-status-warning">
              {fieldErrors.password}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-6 w-full rounded-xl bg-brand-primary px-4 py-3 text-sm font-semibold text-[#171816] shadow-[0_8px_20px_rgba(239,132,47,0.22)] transition hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>

          <div aria-live="polite" role="status">
            {error && (
              <p className="mt-4 rounded-xl border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
                {error}
              </p>
            )}
          </div>

          <p className="mt-8 text-[10px] uppercase tracking-[0.14em] text-text-secondary">
            Protected workspace - PrivateFleet
          </p>
        </form>
      </section>
    </main>
  );
}


