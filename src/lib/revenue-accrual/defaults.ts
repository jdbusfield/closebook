import type { AccrualSettings } from "./types";

/** Starting settings for Hollywood Depot Rentals (QuickBooks: Walk and Talk Production Rentals). */
export const DEFAULT_SETTINGS: AccrualSettings = {
  accruedAccount: { number: "12200", name: "Accrued Revenue" },
  deferredAccount: { number: "21300", name: "Deferred Revenue" },
  // 48003 sublease rent (has its own deferral), 48007 ticket resales, 2xxxx sales tax
  excludeAccountPrefixes: ["48003", "48007", "2"],
  aliases: {
    sdm3: "stdenismedicals3",
    dcc4: "dallascowboyscheerleaderss4",
    luminous: "luminyssystems",
    feltnerfilms: "roblox20",
    luckydogproductions: "hmpg",
    westsideproductionrentals: "westsiderentals",
    cfg: "cfgrentalgroup",
    televerseconference2026: "televerse2026",
    redemptionproductions: "213",
    aicmproductions: "anothericecreamman",
    keenan: "schooleds1",
    afipilna: "afipilina",
    initmacyparty: "intimacyparty",
    caveartformoderntimes: "caveartthemoderntimes",
    smalltalkmovie: "smalltalkmove",
  },
  typeRules: [
    { match: "restroom", account: { number: "42002", name: "Labor & Services:Services" }, className: "Bathrooms" },
    { match: "bins", account: { number: "42004", name: "Labor & Services:Trash" }, className: "Locations" },
    { match: "\\locations\\", account: { number: "49000", name: "Production Supplies:Production Supplies Rental" }, className: "Locations" },
    { match: "trailer", account: { number: "43001", name: "Trailer Rental:Trailer Rental" }, className: "Locations" },
    { match: "walkie", account: { number: "49002", name: "Production Supplies:Production Supplies Rental:Communications" }, className: "Production Supplies" },
    { match: "mifi", account: { number: "49003", name: "Production Supplies:Production Supplies Rental:Internet Services" }, className: "Production Supplies" },
    { match: "truck", account: { number: "43002", name: "Vehicle Rental:Vehicle Rental" }, className: "Production Supplies" },
    { match: "van", account: { number: "43002", name: "Vehicle Rental:Vehicle Rental" }, className: "Production Supplies" },
    { match: " ac ", account: { number: "49001", name: "Production Supplies:Production Supplies Rental:Climate Control" }, className: "A/C" },
  ],
  defaultAccount: { number: "49000", name: "Production Supplies:Production Supplies Rental" },
  defaultClass: "Production Supplies",
  approvedStatuses: ["Approved", "AV-Approved"],
};

export function mergeSettings(saved: Partial<AccrualSettings> | null | undefined): AccrualSettings {
  if (!saved) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    aliases: { ...DEFAULT_SETTINGS.aliases, ...(saved.aliases ?? {}) },
  };
}
