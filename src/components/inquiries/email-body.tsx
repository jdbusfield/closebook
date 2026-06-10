"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// Collapsed-height cap for a long HTML email, in px. Short emails render at
// their natural height (no scrollbar, no toggle); only taller ones clamp here
// and reveal a toggle.
const HTML_COLLAPSED_MAX = 360;

// Renders an HTML email body in a sandboxed iframe, auto-sized to its content so
// the page scrolls naturally instead of a cramped inner scroll box. The iframe
// is sandboxed without `allow-scripts`, so even malicious markup can't execute;
// `allow-same-origin` is what lets us measure the rendered content height (safe
// here precisely because scripting is disabled). The email's own CSS stays
// contained in the frame and can't leak into the app.
function HtmlBody({
  html,
  expanded,
  onToggle,
}: {
  html: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [naturalHeight, setNaturalHeight] = useState<number | null>(null);

  const measure = useCallback(() => {
    const doc = iframeRef.current?.contentWindow?.document;
    if (!doc) return;
    const h = Math.ceil(doc.documentElement.scrollHeight || doc.body.scrollHeight);
    if (h > 0) setNaturalHeight(h + 2); // +2 avoids a 1px rounding scrollbar
  }, []);

  // Measure on load, and keep tracking as late-loading images reflow the body.
  const handleLoad = useCallback(() => {
    measure();
    observerRef.current?.disconnect();
    const doc = iframeRef.current?.contentWindow?.document;
    if (doc && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => measure());
      ro.observe(doc.documentElement);
      observerRef.current = ro;
    }
  }, [measure]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:10px;background:#fff;color:#0b1320;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;word-break:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%!important}a{color:#2563eb}</style></head><body>${html}</body></html>`;

  const overflows = naturalHeight != null && naturalHeight > HTML_COLLAPSED_MAX;
  const full = naturalHeight ?? HTML_COLLAPSED_MAX;
  const height = !overflows || expanded ? full : HTML_COLLAPSED_MAX;

  return (
    <div className="mt-2 space-y-1">
      <div className="relative overflow-hidden rounded border bg-white">
        <iframe
          ref={iframeRef}
          title="Email body"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={srcDoc}
          scrolling="no"
          onLoad={handleLoad}
          style={{ width: "100%", height, display: "block", border: 0 }}
        />
        {overflows && !expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent" />
        )}
      </div>
      {overflows && (
        <button
          type="button"
          onClick={onToggle}
          className="text-xs text-primary hover:underline"
        >
          {expanded ? "Collapse" : "Expand full email"}
        </button>
      )}
    </div>
  );
}

// Renders an email body. HTML goes through the auto-sized sandboxed iframe above;
// falls back to plain text, then to an empty-state note.
export function MessageBody({
  html,
  text,
  expanded,
  onToggle,
}: {
  html: string | null;
  text: string | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (html) {
    return <HtmlBody html={html} expanded={expanded} onToggle={onToggle} />;
  }
  if (text) {
    return (
      <div className="mt-2 space-y-1">
        <div
          className={`whitespace-pre-wrap text-sm text-foreground/90 ${
            expanded ? "" : "line-clamp-6"
          }`}
        >
          {text}
        </div>
        {text.length > 320 && (
          <button
            type="button"
            onClick={onToggle}
            className="text-xs text-primary hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="mt-2 text-xs italic text-muted-foreground">
      (No message body was captured for this email.)
    </div>
  );
}
