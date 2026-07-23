"use client";

// The FAQ tab of the Resources panel — a quick-reference sheet a rep can pull
// up mid-call or while writing an email. Questions render collapsed; expanding
// one shows the answer with a copy button so the answer text can be pasted
// straight into a reply. Search filters across both question and answer.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  HelpCircle,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useFaqs, type FaqItem } from "@/lib/inquiries/use-faqs";

function copyAnswer(item: FaqItem) {
  navigator.clipboard
    .writeText(item.answer)
    .then(() => toast.success("Answer copied — paste it into any email"))
    .catch(() => toast.error("Couldn't copy the answer"));
}

function FaqForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: FaqItem;
  onSave: (question: string, answer: string) => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [answer, setAnswer] = useState(initial?.answer ?? "");
  const valid = question.trim().length > 0 && answer.trim().length > 0;

  return (
    <form
      className="space-y-2 rounded-lg border bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(question.trim(), answer.trim());
      }}
    >
      <Input
        autoFocus
        placeholder="Question — how the customer asks it"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        className="h-8 text-sm"
      />
      <Textarea
        placeholder="Answer — written so it can be copied straight into an email"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={4}
        className="text-sm"
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" className="h-7" disabled={!valid}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function FaqRow({
  item,
  onEdit,
  onDelete,
}: {
  item: FaqItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border">
      <div className="flex items-start gap-1.5 px-2 py-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? (
            <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="text-sm font-medium leading-snug">{item.question}</span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          title="Copy answer"
          onClick={() => copyAnswer(item)}
        >
          <Copy className="size-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7 shrink-0">
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-3.5" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open && (
        <div className="whitespace-pre-wrap border-t px-3 py-2 text-sm leading-relaxed text-foreground/90">
          {item.answer}
        </div>
      )}
    </div>
  );
}

export function FaqPanel({ entityId }: { entityId: string }) {
  const lib = useFaqs(entityId);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lib.faqs;
    return lib.faqs.filter(
      (f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q)
    );
  }, [lib.faqs, query]);

  if (lib.loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search questions and answers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => {
            setAdding(true);
            setEditingId(null);
          }}
        >
          <Plus className="size-3.5" /> Add
        </Button>
      </div>

      {adding && (
        <FaqForm
          onSave={async (question, answer) => {
            await lib.createFaq(question, answer);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {filtered.length === 0 && !adding ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
          <HelpCircle className="size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {lib.faqs.length === 0
              ? "No FAQs yet. Add the questions customers ask most, with answers your team can copy into replies."
              : "No FAQs match your search."}
          </p>
        </div>
      ) : (
        filtered.map((item) =>
          editingId === item.id ? (
            <FaqForm
              key={item.id}
              initial={item}
              onSave={async (question, answer) => {
                await lib.updateFaq(item.id, { question, answer });
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <FaqRow
              key={item.id}
              item={item}
              onEdit={() => {
                setEditingId(item.id);
                setAdding(false);
              }}
              onDelete={() => lib.deleteFaq(item.id)}
            />
          )
        )
      )}
    </div>
  );
}
