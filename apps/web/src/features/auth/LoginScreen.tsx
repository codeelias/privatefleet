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

  return (
    <main className="flex min-h-screen items-center justify-center bg-command-bg px-4 text-text-primary">
      <form
        onSubmit={(event) => void submit(event)}
        noValidate
        className="w-full max-w-sm rounded-2xl border border-command-border bg-command-surface p-8 shadow-xl"
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-primary">
          PrivateFleet
        </p>
        <h1 className="mt-2 text-2xl font-bold">Sign in to dispatch</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Use the workspace, email and password issued to your team.
        </p>

        <label className="mt-6 block text-sm font-medium" htmlFor="tenantSlug">
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
          className="mt-1 w-full rounded-lg border border-command-border bg-command-bg px-3 py-2 text-sm outline-none focus:border-brand-primary"
        />
        {fieldErrors.tenantSlug && (
          <p id="tenantSlug-error" className="mt-1 text-xs text-status-warning">
            {fieldErrors.tenantSlug}
          </p>
        )}

        <label className="mt-4 block text-sm font-medium" htmlFor="email">
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
          className="mt-1 w-full rounded-lg border border-command-border bg-command-bg px-3 py-2 text-sm outline-none focus:border-brand-primary"
        />
        {fieldErrors.email && (
          <p id="email-error" className="mt-1 text-xs text-status-warning">
            {fieldErrors.email}
          </p>
        )}

        <label className="mt-4 block text-sm font-medium" htmlFor="password">
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
          className="mt-1 w-full rounded-lg border border-command-border bg-command-bg px-3 py-2 text-sm outline-none focus:border-brand-primary"
        />
        {fieldErrors.password && (
          <p id="password-error" className="mt-1 text-xs text-status-warning">
            {fieldErrors.password}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-command-bg transition hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>

        <div aria-live="polite" role="status">
          {error && (
            <p className="mt-4 rounded-lg border border-status-danger/50 bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
              {error}
            </p>
          )}
        </div>
      </form>
    </main>
  );
}
