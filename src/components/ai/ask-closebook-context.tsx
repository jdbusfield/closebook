"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "askCloseBook.open";

interface AskCloseBookContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const AskCloseBookContext = createContext<AskCloseBookContextValue | null>(null);

export function AskCloseBookProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let initial = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw != null) {
        initial = raw === "1";
      } else if (window.matchMedia("(min-width: 1280px)").matches) {
        initial = true;
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsOpen(initial);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, isOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [isOpen, hydrated]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  return (
    <AskCloseBookContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </AskCloseBookContext.Provider>
  );
}

export function useAskCloseBook() {
  const ctx = useContext(AskCloseBookContext);
  if (!ctx) throw new Error("useAskCloseBook must be used inside AskCloseBookProvider");
  return ctx;
}
