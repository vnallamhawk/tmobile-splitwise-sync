const API_BASE = "https://secure.splitwise.com/api/v3.0";

export interface SplitwiseMember {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

export interface SplitwiseGroup {
  id: number;
  name: string;
  members: SplitwiseMember[];
}

export interface CreateExpenseInput {
  groupId: number;
  description: string;
  /** Total cost in dollars. */
  total: number;
  paidByUserId: number;
  /** Every user who owes part of the expense, including the payer's own retained share. Dollars, must sum to `total`. */
  owedShares: { userId: number; amount: number }[];
}

export interface CreateExpenseResult {
  id: number;
  description: string;
}

function apiKey(): string {
  const key = process.env.SPLITWISE_API_KEY;
  if (!key) throw new Error("SPLITWISE_API_KEY is not set (see .env.example)");
  return key;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Splitwise API ${path} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function getGroups(): Promise<SplitwiseGroup[]> {
  const data = await request<{ groups: any[] }>("/get_groups");
  return data.groups.map((g) => ({
    id: g.id,
    name: g.name,
    members: g.members.map((m: any) => ({
      id: m.id,
      firstName: m.first_name,
      lastName: m.last_name,
      email: m.email,
    })),
  }));
}

export async function findGroupByName(name: string): Promise<SplitwiseGroup> {
  const groups = await getGroups();
  const group = groups.find((g) => g.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (!group) {
    throw new Error(
      `No Splitwise group named "${name}" found. Groups visible to this API key: ${groups.map((g) => g.name).join(", ")}`
    );
  }
  return group;
}

export function resolveUserIdsByEmail(group: SplitwiseGroup): Map<string, number> {
  const map = new Map<string, number>();
  for (const member of group.members) {
    if (member.email) map.set(member.email.toLowerCase(), member.id);
  }
  return map;
}

export async function createExpense(input: CreateExpenseInput): Promise<CreateExpenseResult> {
  const totalCents = Math.round(input.total * 100);
  const owedCents = input.owedShares.reduce((a, s) => a + Math.round(s.amount * 100), 0);
  if (owedCents !== totalCents) {
    throw new Error(`owedShares (${owedCents}c) don't sum to total (${totalCents}c) for "${input.description}"`);
  }

  const params = new URLSearchParams();
  params.set("cost", input.total.toFixed(2));
  params.set("description", input.description);
  params.set("group_id", String(input.groupId));
  params.set("currency_code", "USD");
  params.set("split_equally", "false");

  input.owedShares.forEach((share, i) => {
    params.set(`users__${i}__user_id`, String(share.userId));
    params.set(`users__${i}__paid_share`, share.userId === input.paidByUserId ? input.total.toFixed(2) : "0.00");
    params.set(`users__${i}__owed_share`, share.amount.toFixed(2));
  });

  const data = await request<{ expenses: any[]; errors?: any }>("/create_expense", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!data.expenses || data.expenses.length === 0) {
    throw new Error(`Splitwise rejected the expense "${input.description}": ${JSON.stringify(data.errors ?? data)}`);
  }

  return { id: data.expenses[0].id, description: data.expenses[0].description };
}
