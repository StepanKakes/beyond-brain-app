// Tenka vrstva nad fetch pro mobilni appku. Nesahame na utils/api.js ani na
// AuthContext: obojí tahá desktopové závislosti a při 401 reloaduje stránku.

const TOKEN_KEY = 'auth-token';

/** Ukázkový režim: /m?ukazka běží na vymyšlených datech, bez serveru a přihlášení. */
export const UKAZKA = (() => {
  try {
    if (new URLSearchParams(window.location.search).has('ukazka')) {
      sessionStorage.setItem('m-ukazka', '1');
    }
    return sessionStorage.getItem('m-ukazka') === '1';
  } catch {
    return false;
  }
})();

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* bez úložiště se přihlášení jen nezapamatuje */
  }
  window.dispatchEvent(new Event('m-auth'));
}

type Options = { method?: string; body?: unknown };

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  if (UKAZKA) {
    const { mockApi } = await import('./ukazka');
    return mockApi(path, options) as T;
  }
  const token = getToken();
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const refreshed = response.headers.get('X-Refreshed-Token');
  if (refreshed) setToken(refreshed);

  if (response.status === 401 && !path.startsWith('/api/auth/login')) {
    setToken(null);
    throw new Error('Přihlášení vypršelo');
  }

  // Cloudflare umí místo chyby vrátit HTML, takže text čteme opatrně.
  const raw = await response.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    /* není JSON */
  }
  if (!response.ok) {
    const message = (data as { error?: string } | null)?.error;
    throw new Error(message || 'Server teď neodpovídá');
  }
  return data as T;
}

export async function login(username: string, password: string): Promise<void> {
  const data = await api<{ token?: string; error?: string }>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  if (!data?.token) throw new Error(data?.error || 'Přihlášení se nepovedlo');
  setToken(data.token);
}
