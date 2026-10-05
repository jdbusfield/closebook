import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HDR_ENTITY_ID } from "@/lib/inquiries/shared";
import { categoryFor, normalizePricing, quoteTrailers, rentalDays, MAX_DAYS } from "@/lib/inquiries/ai-pricing";

export const runtime = "nodejs";

// Price lookup for the HDR AI callback agent (an ElevenLabs server tool).
// The agent sends the event type, guest count and dates; this returns the
// trailer count and total from JD's AI Price Table (rental_inquiry_ai_pricing),
// so the agent never does the math itself.
// Authenticated by the x-ai-tool-secret header (AI_PRICE_TOOL_SECRET), which
// is stored as a secret on the ElevenLabs tool.

interface PriceBody {
  event_type?: string;
  guests?: number | string;
  start_date?: string;
  end_date?: string;
  days?: number | string;
  attendant_hours?: number | string;
}

function authorized(req: Request): boolean {
  const secret = process.env.AI_PRICE_TOOL_SECRET;
  const got = req.headers.get("x-ai-tool-secret");
  if (!secret || !got) return false;
  const a = Buffer.from(got, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: PriceBody;
  try {
    body = (await req.json()) as PriceBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const guests = Number(body.guests);
  if (!Number.isFinite(guests) || guests <= 0) {
    return NextResponse.json({ error: "guests is required. Ask the customer for the guest count, then try again." });
  }

  let days = body.days !== undefined && body.days !== "" ? Number(body.days) : NaN;
  if (!Number.isFinite(days) && body.start_date) days = rentalDays(body.start_date, body.end_date) ?? NaN;
  if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS) {
    return NextResponse.json({
      error: "Could not work out the rental days. Send start_date and end_date as YYYY-MM-DD, or days.",
    });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rental_inquiry_ai_pricing")
    .select("*")
    .eq("entity_id", HDR_ENTITY_ID)
    .maybeSingle();
  if (error) console.error("ai-price: pricing read failed, using defaults", error.message);
  const pricing = normalizePricing(data);

  const attendant = Number(body.attendant_hours);
  const q = quoteTrailers(
    {
      category: categoryFor(body.event_type),
      guests,
      days,
      attendantHours: Number.isFinite(attendant) ? attendant : null,
    },
    pricing
  );

  const trailerWord = q.trailers === 1 ? "one 4-stall trailer" : `${q.trailers} 4-stall trailers`;
  const dayWord = q.days === 1 ? "the day" : `the ${q.days}-day rental`;
  return NextResponse.json({
    trailers: q.trailers,
    days: q.days,
    rate_category: q.category === "private" ? "backyard / private party" : "wedding / event",
    discount_pct: q.discount_pct,
    attendant_hours: q.attendant_hours,
    total: q.total,
    say_total: q.say_total,
    say: `For ${q.guests} guests we'd recommend ${trailerWord}. We'd typically quote around ${money(q.say_total)} for ${dayWord}${q.attendant_hours ? `, including an attendant for ${q.attendant_hours} hours` : ""}.`,
  });
}
