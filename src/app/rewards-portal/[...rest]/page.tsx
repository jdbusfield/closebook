import { notFound } from "next/navigation";

// Any unknown portal path is the portal's own 404. Without this, a path like
// /rewards-portal/dashboard would fall through to Closebook's /[entityId]
// routes; on the portal domain no Closebook page should ever be reachable.
export default function PortalCatchAll() {
  notFound();
}
