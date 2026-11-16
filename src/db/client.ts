type Filter = { column: string; op: string; value: unknown };
type Order = { column: string; ascending: boolean };
type Request = {
  table: string;
  action: "select" | "insert" | "update" | "delete" | "upsert";
  columns?: string;
  values?: unknown;
  filters: Filter[];
  orders: Order[];
  limit?: number;
  single?: boolean;
  count?: boolean;
  head?: boolean;
  onConflict?: string;
};

async function send(body: unknown): Promise<any> {
  try {
    const response = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (response.status === 401) window.dispatchEvent(new Event("session-expired"));
    if (!response.ok) return { data: null, error: new Error(result.error || "Falha no servidor"), count: null };
    return { ...result, error: null };
  } catch (cause) {
    return { data: null, error: cause instanceof Error ? cause : new Error(String(cause)), count: null };
  }
}

class QueryBuilder implements PromiseLike<any> {
  private request: Request;

  constructor(table: string) {
    this.request = { table, action: "select", filters: [], orders: [] };
  }

  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    this.request.columns = columns;
    this.request.count = options?.count === "exact";
    this.request.head = options?.head;
    return this;
  }

  insert(values: unknown) { this.request.action = "insert"; this.request.values = values; return this; }
  update(values: unknown) { this.request.action = "update"; this.request.values = values; return this; }
  delete() { this.request.action = "delete"; return this; }
  upsert(values: unknown, options?: { onConflict?: string }) {
    this.request.action = "upsert";
    this.request.values = values;
    this.request.onConflict = options?.onConflict;
    return this;
  }
  eq(column: string, value: unknown) { return this.filter(column, "eq", value); }
  neq(column: string, value: unknown) { return this.filter(column, "neq", value); }
  gt(column: string, value: unknown) { return this.filter(column, "gt", value); }
  gte(column: string, value: unknown) { return this.filter(column, "gte", value); }
  lt(column: string, value: unknown) { return this.filter(column, "lt", value); }
  lte(column: string, value: unknown) { return this.filter(column, "lte", value); }
  is(column: string, value: unknown) { return this.filter(column, "is", value); }
  in(column: string, value: unknown[]) { return this.filter(column, "in", value); }
  not(column: string, op: string, value: unknown) { return this.filter(column, `not.${op}`, value); }
  private filter(column: string, op: string, value: unknown) {
    this.request.filters.push({ column, op, value });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.request.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }
  limit(value: number) { this.request.limit = value; return this; }
  single() { this.request.single = true; return this; }
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return send(this.request).then(onfulfilled, onrejected);
  }
}

export const db = {
  from: (table: string) => new QueryBuilder(table),
  rpc: (name: string, args: Record<string, unknown>) => send({ action: "rpc", name, args }),
};
