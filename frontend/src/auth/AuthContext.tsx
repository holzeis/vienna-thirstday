import { useCallback, useEffect, useState, type ReactNode } from "react";
import { fetchMe, login as apiLogin } from "../api/endpoints";
import { getAuthToken, setAuthToken } from "../api/client";
import type { Player, User } from "../api/types";
import { AuthContext } from "./context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  // Nothing to wait for without a stored token, so start out already loaded in that case.
  const [loading, setLoading] = useState(() => getAuthToken() !== null);

  const refresh = useCallback(async () => {
    if (!getAuthToken()) {
      setUser(null);
      setPlayer(null);
      setLoading(false);
      return;
    }
    try {
      const res = await fetchMe();
      setUser(res.user);
      setPlayer(res.player);
    } catch {
      setAuthToken(null);
      setUser(null);
      setPlayer(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial session restore. Same lookup as refresh(), written with .then so every
  // setState happens asynchronously; with no stored token `loading` already starts false.
  useEffect(() => {
    if (!getAuthToken()) return;
    fetchMe()
      .then((res) => {
        setUser(res.user);
        setPlayer(res.player);
      })
      .catch(() => setAuthToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (name: string, password: string) => {
    const res = await apiLogin(name, password);
    setAuthToken(res.token);
    setUser(res.user);
    await refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    setPlayer(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, player, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
