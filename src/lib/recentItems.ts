/** Itens usados recentemente nas movimentações (guardados só neste navegador). */
const RECENT_KEY = "movements:recent-items";
const MAX_RECENT = 5;

export function pushRecentItem(itemId: string) {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const next = [itemId, ...list.filter((id) => id !== itemId)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function getRecentItems(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
