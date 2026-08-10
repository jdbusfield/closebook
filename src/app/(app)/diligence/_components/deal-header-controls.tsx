"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DEAL_STAGE_ORDER, DEAL_STAGE_LABEL } from "./diligence-shared";

export function DealHeaderControls({ dealId, stage, dealName }: { dealId: string; stage: string; dealName: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <select
        className="h-8 rounded-md border bg-transparent px-2 text-sm"
        value={stage}
        disabled={saving}
        onChange={async e => {
          setSaving(true);
          await fetch(`/api/diligence/deals/${dealId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stage: e.target.value }),
          });
          setSaving(false);
          router.refresh();
        }}
      >
        {DEAL_STAGE_ORDER.map(s => (
          <option key={s} value={s}>{DEAL_STAGE_LABEL[s]}</option>
        ))}
      </select>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" className="text-rose-600">
            <Trash2 className="h-4 w-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {dealName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the deal and its entire diligence checklist.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={async () => {
                await fetch(`/api/diligence/deals/${dealId}`, { method: "DELETE" });
                router.push("/diligence");
                router.refresh();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
