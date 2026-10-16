/** POST an action to /api/rewards; throws the server's error message. */
export async function rewardsCall<T = Record<string, unknown>>(action: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/rewards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || "Request failed");
  return data as T;
}

export const fmtMoney = (n: number | null | undefined) =>
  n == null ? "" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const fmtPoints = (n: number | null | undefined) => (n == null ? "" : Math.round(n).toLocaleString("en-US"));

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};

export const STATUS_LABEL: Record<string, string> = {
  shadow: "Not activated",
  active: "Active",
  opted_out: "Opted out",
};
