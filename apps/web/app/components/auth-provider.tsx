"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  getCurrentUser,
  login as apiLogin,
  logout as apiLogout,
  signup as apiSignup,
  type AuthUser
} from "../lib/pdf-api";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<AuthUser>;
  signup: (input: { email: string; password: string; name?: string }) => Promise<AuthUser>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async (): Promise<void> => {
    try {
      setUser(await getCurrentUser());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      refresh,
      login: async (input) => {
        const nextUser = await apiLogin(input);
        setUser(nextUser);
        return nextUser;
      },
      signup: async (input) => {
        const nextUser = await apiSignup(input);
        setUser(nextUser);
        return nextUser;
      },
      logout: async () => {
        setUser(null);
        await apiLogout().catch(() => undefined);
      }
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}
