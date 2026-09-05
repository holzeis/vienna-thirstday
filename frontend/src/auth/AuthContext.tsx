import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchMe, login as apiLogin } from "../api/endpoints";
import { getAuthToken, setAuthToken } from "../api/client";
import type { Player, User } from "../api/types";

interface AuthState {
  user: User | null;
  player: Player | null;
  loading: boolean;
  login: (name: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    refresh();
  }, [refresh]);

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

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
