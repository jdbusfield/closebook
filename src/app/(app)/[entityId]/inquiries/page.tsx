"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "./status-badge";
import { INQUIRY_STATUSES, STATUS_LABELS } from "@/lib/inquiries/shared";

interface InquiryRow {
  id: string;
  reference: string;
  status: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  use_case: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  units: number | null;
  last_activity_at: string | null;
  created_at: string;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function InquiriesPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const [inquiries, setInquiries] = useState<InquiryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const fetchInquiries = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from("rental_inquiries")
      .select(
        "id, reference, status, name, email, phone, use_case, location, start_date, end_date, units, last_activity_at, created_at"
      )
      .eq("entity_id", entityId)
      .order("last_activity_at", { ascending: false })
      .limit(500);
    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    const { data } = await query;
    setInquiries((data as InquiryRow[]) ?? []);
    setLoading(false);
  }, [entityId, statusFilter]);

  useEffect(() => {
    fetchInquiries();
  }, [fetchInquiries]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inquiries</h1>
          <p className="text-sm text-muted-foreground">
            Inbound rental requests from hdrsiteservices.com
          </p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {INQUIRY_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? "Loading…" : `${inquiries.length} inquiries`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Use case</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-center">Units</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && inquiries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No inquiries yet.
                  </TableCell>
                </TableRow>
              )}
              {inquiries.map((inq) => (
                <TableRow key={inq.id} className="cursor-pointer">
                  <TableCell className="font-mono text-xs">
                    <Link
                      href={`/${entityId}/inquiries/${inq.id}`}
                      className="text-primary hover:underline"
                    >
                      {inq.reference}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{inq.name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{inq.email || ""}</div>
                  </TableCell>
                  <TableCell>{inq.use_case || "—"}</TableCell>
                  <TableCell className="max-w-[180px] truncate">{inq.location || "—"}</TableCell>
                  <TableCell className="text-xs">
                    {inq.start_date || "—"}
                    {inq.end_date ? ` → ${inq.end_date}` : ""}
                  </TableCell>
                  <TableCell className="text-center">{inq.units ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={inq.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(inq.last_activity_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
