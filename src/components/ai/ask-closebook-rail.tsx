"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X, Send, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAskCloseBook } from "./ask-closebook-context";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolEvents?: ToolEvent[];
  error?: string;
}

interface ToolEvent {
  name: string;
  status: "running" | "done" | "error";
}

const TOOL_LABELS: Record<string, string> = {
  get_entities: "Loading entities",
  get_income_statement: "Reading financial model",
  search_chart_of_accounts: "Searching chart of accounts",
  get_trial_balance: "Reading raw trial balance",
  get_debt_summary: "Reading debt schedule",
  list_rental_assets: "Reading rental assets",
  get_close_status: "Checking close status",
  get_rebate_tracker: "Reading rebate tracker",
};

export function AskCloseBookRail() {
  const { isOpen, close } = useAskCloseBook();
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  if (!isOpen) return null;

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      toolEvents: [],
    };
    const next = [...messages, userMsg, assistantMsg];
    setMessages(next);
    setInput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          pathname,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "Request failed");
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, error: text } : m)),
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          let event: { type: string; [k: string]: unknown };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          handleEvent(event, assistantId);
        }
      }
    } catch (e) {
      const message =
        e instanceof Error && e.name === "AbortError"
          ? "Cancelled"
          : e instanceof Error
            ? e.message
            : String(e);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, error: message } : m)),
      );
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  function handleEvent(
    event: { type: string; [k: string]: unknown },
    assistantId: string,
  ) {
    if (event.type === "text") {
      const delta = String(event.delta ?? "");
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
      );
    } else if (event.type === "tool_start") {
      const name = String(event.name);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                toolEvents: [...(m.toolEvents ?? []), { name, status: "running" }],
              }
            : m,
        ),
      );
    } else if (event.type === "tool_end") {
      const name = String(event.name);
      const isError = Boolean(event.error);
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m;
          const events = (m.toolEvents ?? []).slice();
          for (let i = events.length - 1; i >= 0; i--) {
            if (events[i].name === name && events[i].status === "running") {
              events[i] = { name, status: isError ? "error" : "done" };
              break;
            }
          }
          return { ...m, toolEvents: events };
        }),
      );
    } else if (event.type === "error") {
      const message = String(event.message ?? "Unknown error");
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, error: message } : m)),
      );
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <aside className="hidden md:flex w-96 shrink-0 flex-col border-l bg-background">
      <div className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Ask CloseBook</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={close}
          aria-label="Close panel"
          className="h-7 w-7"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} streaming={streaming} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t p-3">
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about anything in CloseBook…"
            rows={2}
            className="resize-none pr-10"
            disabled={streaming}
          />
          <Button
            size="icon"
            onClick={send}
            disabled={streaming || input.trim().length === 0}
            className="absolute bottom-2 right-2 h-7 w-7"
            aria-label="Send"
          >
            {streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Read-only. Numbers come from CloseBook tools — verify on the source page before relying.
        </p>
      </div>
    </aside>
  );
}

function EmptyState() {
  return (
    <div className="text-sm text-muted-foreground">
      <p className="mb-3">Ask about CloseBook data — entities, trial balance, debt, rental assets, close tasks, accounts, rebates.</p>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide">Examples</p>
      <ul className="space-y-1 text-xs">
        <li>• What&apos;s our outstanding debt for ARH?</li>
        <li>• Show open close tasks for last month.</li>
        <li>• Total book value of vehicles right now.</li>
        <li>• YTD rebate accrued for top 3 customers.</li>
      </ul>
    </div>
  );
}

function MessageBubble({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[90%] rounded-lg px-3 py-2 text-sm",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        {message.toolEvents && message.toolEvents.length > 0 && (
          <div className="mb-2 space-y-1">
            {message.toolEvents.map((t, i) => (
              <ToolChip key={i} event={t} />
            ))}
          </div>
        )}
        {message.content ? (
          isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : (
            <MarkdownContent content={message.content} />
          )
        ) : !message.error && streaming && !isUser ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-xs">Thinking…</span>
          </div>
        ) : null}
        {message.error && (
          <div className="mt-1 flex items-start gap-1 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{message.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolChip({ event }: { event: ToolEvent }) {
  const label = TOOL_LABELS[event.name] ?? event.name;
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      {event.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
      {event.status === "done" && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
      {event.status === "error" && <AlertCircle className="h-3 w-3 text-destructive" />}
      <span>{label}</span>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-body break-words text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          h1: ({ children }) => <h3 className="mt-3 mb-1 text-sm font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="mt-3 mb-1 text-sm font-semibold">{children}</h3>,
          h3: ({ children }) => <h4 className="mt-2 mb-1 text-sm font-semibold">{children}</h4>,
          ul: ({ children }) => <ul className="my-2 ml-4 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 ml-4 list-decimal space-y-1">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded bg-background px-1 py-0.5 font-mono text-[12px]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded bg-background p-2 font-mono text-[12px]">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-border" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-b border-border/50 last:border-0">{children}</tr>,
          th: ({ children, style }) => (
            <th
              style={style}
              className="px-2 py-1.5 text-left font-semibold text-foreground"
            >
              {children}
            </th>
          ),
          td: ({ children, style }) => (
            <td style={style} className="px-2 py-1 align-top tabular-nums">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
