/**
 * Member portal building blocks (direction A, "Night Lot"): black page,
 * #121212 cards with a red bottom stripe, red labels, white pill buttons.
 * Title Case copy, one font (Archivo 400/600), no all-caps or letter-spacing.
 */

import Link from "next/link";

export const LOGO_WHITE = "/rewards-portal-assets/vs-wordmark-white.png";
export const WAREHOUSE_PHOTO = "/rewards-portal-assets/warehouse-night.jpg";

export function Logo({ height = 20 }: { height?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO_WHITE} alt="Versatile Studios" style={{ height, width: "auto" }} />;
}

export function StaffBanner({ show, preview }: { show: boolean; preview: boolean }) {
  if (!show) return null;
  return (
    <div className="bg-[#D2232A] px-5 py-2 text-[13px] font-semibold">
      Staff Preview · Read Only{preview ? " · Includes 2026 Preview" : ""}
    </div>
  );
}

export function SubHeader({ backHref, title, right }: { backHref: string; title: string; right?: React.ReactNode }) {
  return (
    <header className="flex h-16 flex-none items-center justify-between pl-2 pr-5">
      <div className="flex min-w-0 items-center gap-1">
        <Link href={backHref} aria-label="Back" className="flex h-11 w-11 flex-none items-center justify-center text-white">
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <h1 className="truncate text-xl font-semibold">{title}</h1>
      </div>
      {right}
    </header>
  );
}

export function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`text-[13px] font-semibold text-[#FF3B42] ${className}`}>{children}</span>;
}

export function StripeCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded-lg border border-[#2A2A2A] bg-[#121212] ${className}`}>
      <div className="flex flex-col gap-0.5 px-[18px] py-4">{children}</div>
      <div className="h-1.5 bg-[#D2232A]" />
    </section>
  );
}

export function Rows({ rows, className = "" }: { rows: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <div className={`flex flex-col text-[15px] ${className}`}>
      {rows.map(([k, v], i) => (
        <div key={i} className={`flex justify-between gap-4 py-2.5 ${i < rows.length - 1 ? "border-b border-[#222]" : ""}`}>
          <span className="text-[#9A9A9A]">{k}</span>
          <span className="text-right">{v}</span>
        </div>
      ))}
    </div>
  );
}

type PillKind = "white" | "outline" | "red";
const PILL: Record<PillKind, string> = {
  white: "bg-white text-black border-2 border-white",
  outline: "border-2 border-white text-white",
  red: "bg-[#D2232A] text-white border-2 border-[#D2232A]",
};

export function Pill({ href, kind = "outline", children, block = false }: { href: string; kind?: PillKind; children: React.ReactNode; block?: boolean }) {
  return (
    <Link
      href={href}
      className={`${PILL[kind]} ${block ? "flex h-[52px] w-full justify-center text-[15px]" : "inline-flex min-h-11 px-[18px] text-[14px]"} items-center rounded-full font-semibold no-underline`}
    >
      {children}
    </Link>
  );
}

export function PillButton({ kind = "red", children, disabled = false }: { kind?: PillKind; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={`${PILL[kind]} flex h-[52px] w-full cursor-pointer items-center justify-center rounded-full text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

export function FilterPills({ items }: { items: { href: string; label: string; active: boolean }[] }) {
  return (
    <nav aria-label="Filter" className="flex flex-wrap gap-2">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={`inline-flex h-9 items-center rounded-full px-3.5 text-[13.5px] no-underline ${i.active ? "bg-white font-semibold text-black" : "border-[1.5px] border-[#5A5A5A] text-white"}`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function ProgressBar({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1.5 bg-[#333]" role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-1.5 bg-white" style={{ width: `${w}%` }} />
    </div>
  );
}

export function Chevron() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-[#5A2A2A] bg-[#1A0B0C] px-4 py-3 text-[14px] text-[#FFB3B6]">{children}</p>;
}
