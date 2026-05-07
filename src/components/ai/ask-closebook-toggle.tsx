"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAskCloseBook } from "./ask-closebook-context";

export function AskCloseBookToggle() {
  const { isOpen, toggle } = useAskCloseBook();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={isOpen ? "Close CloseBook AI" : "Open CloseBook AI"}
      aria-pressed={isOpen}
      className="h-8 w-8"
    >
      <Sparkles className="h-4 w-4" />
    </Button>
  );
}
