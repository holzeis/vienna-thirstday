import { createContext } from "react";
import type { Player, User } from "../api/types";

export interface AuthState {
  user: User | null;
  player: Player | null;
  loading: boolean;
  login: (name: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | undefined>(undefined);
