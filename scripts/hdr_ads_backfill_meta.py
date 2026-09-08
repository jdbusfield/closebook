"""One-off: load the Meta daily ad rows (Aug 31 - Sep 8, pulled through the Meta
Ads MCP on Sep 8) into ad_platform_daily so the Ads tab has history before the
Meta token is upgraded. Safe to re-run: upserts on the natural key. Needs
migration 20260908 applied. Reads the service-role key from .env.local."""
import csv, json, sys, urllib.request, urllib.error
ENV = "C:/Users/JDBusfield/Documents/MyProjects/_closebook_work/.env.local"
CSV = sys.argv[1] if len(sys.argv) > 1 else "C:/Users/JDBusfield/AppData/Local/Temp/claude/C--Users-JDBusfield/e1dd405f-bf8c-48ec-b5df-14d441cb78a6/scratchpad/meta_backfill.csv"
HDR = "7529580d-3b44-4a9b-91f4-bc2db25f5211"
env = {}
for line in open(ENV, encoding="utf-8"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); env[k] = v.strip().strip('"').strip("'")
URL = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/"); KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json",
     "Prefer": "resolution=merge-duplicates,return=minimal"}
rows = []
for r in csv.DictReader(open(CSV, encoding="utf-8")):
    rows.append({"entity_id": HDR, "platform": "meta", "date": r["date"], "campaign_id": r["campaign_id"],
        "campaign_name": r["campaign_name"], "adset_id": r["adset_id"], "adset_name": r["adset_name"],
        "ad_id": r["ad_id"], "ad_name": r["ad_name"], "spend": float(r["spend"]), "impressions": int(r["impressions"]),
        "clicks": int(r["clicks"]), "reach": int(r["reach"]), "platform_conversions": float(r["leads"]), "currency": "USD",
        "raw": {"source": "meta_ads_mcp_backfill_2026-09-08"}})
req = urllib.request.Request(URL + "/rest/v1/ad_platform_daily?on_conflict=entity_id,platform,date,campaign_id,adset_id,ad_id",
                             data=json.dumps(rows).encode(), headers=H, method="POST")
try:
    urllib.request.urlopen(req); print("upserted", len(rows), "meta rows")
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read()[:400].decode(errors="replace"))
