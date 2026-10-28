/**
 * Session storage (docs/05.4 auth): tokens and the resolved tenant are
 * kept in localStorage so a refresh keeps the session. The access token
 * carries an absolute expiry; the client refreshes before it lapses.
 */
export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  /** Access-token lifetime in ms (refresh horizon scales with it). */
  accessTtlMs: number;
  tenant: { id: string; slug: string; name: string };
  user: { id: string; email: string; role: string };
}

const KEY = "privatefleet.session.v1";

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.tenant?.id) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable (private mode): the in-memory session still works.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

