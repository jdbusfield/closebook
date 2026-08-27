// Turn a failed fetch into a message a rep can act on. Our routes return
// `{ error: "…" }`, but anything in front of the function (Vercel platform or
// firewall responses) returns `{ error: { code, message } }` — rendering that
// with template-string coercion gave the useless "[object Object]" toast.
export function apiErrorMessage(
  body: unknown,
  status: number,
  fallback = "Request failed"
): string {
  const b = (body ?? {}) as { error?: unknown; detail?: unknown; message?: unknown };
  const pick = (v: unknown): string | null => {
    if (typeof v === "string" && v.trim()) return v;
    if (v && typeof v === "object") {
      const o = v as { message?: unknown; code?: unknown };
      const msg = typeof o.message === "string" ? o.message : null;
      const code = typeof o.code === "string" ? o.code : null;
      if (msg && code) return `${msg} (${code})`;
      return msg ?? code ?? null;
    }
    return null;
  };
  const text = pick(b.error) ?? pick(b.detail) ?? pick(b.message);
  return text ? `${text} (HTTP ${status})` : `${fallback} (HTTP ${status})`;
}
