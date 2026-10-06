import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, post, setCsrf } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState(null);

  const refresh = useCallback(async () => {
    try { const r = await get('/user/profile'); setCsrf(r.csrfToken); setUser(r.user); }
    catch { setUser(null); setCsrf(''); }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([refresh(), get('/health').then(setConfig).catch(() => {})]);
      setReady(true);
    })();
  }, [refresh]);

  const value = useMemo(() => ({
    user, ready, config, refresh,
    async login(email, password) { const r = await post('/auth/login', { email, password }); setCsrf(r.csrfToken); setUser(r.user); return r.user; },
    async logout() { try { await post('/auth/logout'); } finally { setCsrf(''); setUser(null); } },
  }), [user, ready, config, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
