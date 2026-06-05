"use client";

// Embed context for the HDR Sales CRM. When the inquiries UI is rendered inside
// the `(embed)/embed/hdr/inquiries/*` route group (iframed into an external
// site), there is no Supabase user session — so the data hooks and views can't
// read/write Supabase directly. Instead they detect this context and route every
// read/write through the key-authenticated `/api/inquiries/embed` route (and the
// embed-aware REST routes), sending the static `EMBED_API_KEY` in an
// `x-embed-key` header.
//
// `useEmbed()` returns null in the normal logged-in app, so all existing usage is
// completely unaffected — the hooks only take the embed path when a provider is
// present.

import { createContext, useContext } from "react";

export interface EmbedContextValue {
  /** HDR entity id (forced server-side too; supplied here for client display). */
  entityId: string;
  /** The EMBED_API_KEY, sent as `x-embed-key` on every embed request. */
  embedKey: string;
  /** URL base for in-section navigation, e.g. "/embed/hdr/inquiries". */
  basePath: string;
}

const EmbedContext = createContext<EmbedContextValue | null>(null);

export function EmbedProvider({
  value,
  children,
}: {
  value: EmbedContextValue;
  children: React.ReactNode;
}) {
  return <EmbedContext.Provider value={value}>{children}</EmbedContext.Provider>;
}

// Null when not embedded (the normal logged-in app).
export function useEmbed(): EmbedContextValue | null {
  return useContext(EmbedContext);
}
