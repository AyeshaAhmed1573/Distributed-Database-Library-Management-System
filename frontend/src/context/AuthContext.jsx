import { createContext, useContext, useState, useCallback } from "react";
import { loginUser, registerUser } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  });

  const persist = useCallback((user, token) => {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
    setUser(user);
  }, []);

  const login = useCallback(
    async (username, password) => {
      const { user, token } = await loginUser({ username, password });
      persist(user, token);
    },
    [persist]
  );

  const register = useCallback(
    async (payload) => {
      const { user, token } = await registerUser(payload);
      persist(user, token);
    },
    [persist]
  );

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
