/**
 * Session hook: boot, login, refresh-on-expiry, logout (docs/05.4).
 * Demo mode skips authentication entirely (ADR-0007); production mode
 * requires a session and clears it safely when refresh fails.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthSession } from "@privatefleet/contracts";
import { api, configureAuth } from "../api/client.js";
import { configureSocketAuth } from "../realtime/socket.js";
import {
  clearSession,
  loadSession,
  saveSession,
  type StoredSession,
} from "./session.js";

export type AuthState =
  | { kind: "booting" }
  | { kind: "demo" }
  | { kind: "anonymous" }
  | { kind: "authenticated"; session: StoredSession };

export function useSession(): {
  state: AuthState;
  login: (input: { tenantSlug: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
} {
  const [state, setState] = useState<AuthState>({ kind: "booting" });
  const sessionRef = useRef<StoredSession | null>(null);
  const refreshInFlight = useRef<Promise<StoredSession | null> | null>(null);

  const applySession = useCallback((session: StoredSession): void => {
    sessionRef.current = session;
    saveSession(session);
    setState({ kind: "authenticated", session });
  }, []);

  const clear = useCallback((): void => {
    sessionRef.current = null;
    clearSession();
    setState({ kind: "anonymous" });
  }, []);

  const refreshNow = useCallback(async (): Promise<StoredSession | null> => {
    const current = sessionRef.current;
    if (!current) {
      return null;
    }
    if (!refreshInFlight.current) {
      refreshInFlight.current = (async () => {
        try {
          const tokens = await api.refresh(current.refreshToken);
          const next: StoredSession = {
            ...current,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: Date.now() + tokens.expiresIn * 1000,
            accessTtlMs: tokens.expiresIn * 1000,
          };
          applySession(next);
          return next;
        } catch {
          clear();
          return null;
        } finally {
          refreshInFlight.current = null;
        }
      })();
    }
    return refreshInFlight.current;
  }, [applySession, clear]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const current = sessionRef.current;
    if (!current) {
      return null;
    }
    // Refresh shortly before expiry; long-lived tokens get a 15s
    // horizon, short-lived ones refresh once under half their lifetime.
    const horizon = Math.min(15_000, Math.floor(current.accessTtlMs / 2));
    if (Date.now() >= current.expiresAt - horizon) {
      const next = await refreshNow();
      return next?.accessToken ?? null;
    }
    return current.accessToken;
  }, [refreshNow]);

  useEffect(() => {
    configureAuth({ getAccessToken, onRefreshFailed: clear });
    configureSocketAuth(getAccessToken);
    return () => {
      configureAuth(null);
      configureSocketAuth(null);
    };
  }, [getAccessToken, clear]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meta = await api.meta();
        if (cancelled) {
          return;
        }
        if (meta.demoMode) {
          setState({ kind: "demo" });
          return;
        }
        const stored = loadSession();
        if (stored) {
          sessionRef.current = stored;
          setState({ kind: "authenticated", session: stored });
        } else {
          setState({ kind: "anonymous" });
        }
      } catch {
        if (!cancelled) {
          setState({ kind: "anonymous" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (input: { tenantSlug: string; email: string; password: string }): Promise<void> => {
      const response: AuthSession = await api.login(input);
      applySession(api.sessionFrom(response, response.tokens));
    },
    [applySession],
  );

  const logout = useCallback(async (): Promise<void> => {
    const current = sessionRef.current;
    try {
      if (current) {
        await api.logout(current.refreshToken);
      }
    } catch {
      // Server session already gone: local clear is still the safe outcome.
    }
    clear();
  }, [clear]);

  return { state, login, logout };
}


