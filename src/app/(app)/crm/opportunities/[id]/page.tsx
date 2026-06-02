import { notFound } from "next/navigation";
import Link from "next/link";
import { Briefcase, ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getCrmOpportunity,
  getCrmOpportunityComments,
} from "@/lib/db/queries/crm";
import { getCrmTasksForEntity } from "@/lib/db/queries/crm-tasks";
import { getCrmNotesForEntity } from "@/lib/db/queries/crm-notes";
import { getOrgMembers } from "@/lib/db/queries/crm-owners";
import { OwnerCombobox } from "../../_components/owner-combobox";
import { TasksTab } from "../../_components/tasks-tab";
import { NotesTab } from "../../_components/notes-tab";
import { createClient } from "@/lib/supabase/server";
import {
  OpportunityStatusBadge,
  PriorityBadge,
  formatDate,
  formatDateTime,
  formatMoney,
  segmentLabel,
} from "../../_components/crm-shared";

interface PageProps { params: Promise<{ id: string }> }

interface OpportunityRecord {
  id: string;
  description: string;
  current_segment: string;
  status: string;
  priority: string;
  amount: number | null;
  salesperson: string | null;
  status_comment: string | null;
  created_at: string;
  owner_id: string | null;
  production: { id: string; name: string; status: string } | null;
  contact: { id: string; name: string; role: string; email: string | null; phone: string | null } | null;
}

export default async function OpportunityDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [opportunityRaw, comments, tasks, notes, members, currentUser] = await Promise.all([
    getCrmOpportunity(id),
    getCrmOpportunityComments(id),
    getCrmTasksForEntity("opportunity", id),
    getCrmNotesForEntity("opportunity", id),
    getOrgMembers(),
    (async () => {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    })(),
  ]);
  const opportunity = opportunityRaw as unknown as OpportunityRecord | null;
  if (!opportunity) notFound();
  const ownerName = opportunity.owner_id ? (members.find(m => m.id === opportunity.owner_id)?.full_name ?? null) : null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/crm/opportunities" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          <ArrowLeft className="h-3 w-3" /> Back to opportunities
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Briefcase className="h-6 w-6" /> {opportunity.description}
            </h1>
            <div className="mt-2 flex items-center gap-2">
              <OpportunityStatusBadge status={opportunity.status} />
              <PriorityBadge priority={opportunity.priority} />
              <span className="text-sm text-muted-foreground">{segmentLabel(opportunity.current_segment)}</span>
              {opportunity.amount != null && (
                <span className="text-sm font-medium">{formatMoney(opportunity.amount)}</span>
              )}
            </div>
          </div>
          <OwnerCombobox
            entityType="opportunity"
            entityId={id}
            currentOwnerId={opportunity.owner_id}
            currentOwnerName={ownerName}
            members={members}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Production</CardTitle></CardHeader>
          <CardContent>
            {opportunity.production ? (
              <div>
                <Link href={`/crm/productions/${opportunity.production.id}`} className="text-base font-medium hover:underline">
                  {opportunity.production.name}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">Status: {opportunity.production.status}</p>
              </div>
            ) : <p className="text-sm text-muted-foreground">No production linked.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
          <CardContent>
            {opportunity.contact ? (
              <div className="space-y-1">
                <Link href={`/crm/contacts/${opportunity.contact.id}`} className="text-base font-medium hover:underline">
                  {opportunity.contact.name}
                </Link>
                <p className="text-xs text-muted-foreground">{opportunity.contact.role}</p>
                {opportunity.contact.email && (
                  <p className="text-xs"><a href={`mailto:${opportunity.contact.email}`} className="hover:underline">{opportunity.contact.email}</a></p>
                )}
                {opportunity.contact.phone && (
                  <p className="text-xs">{opportunity.contact.phone}</p>
                )}
              </div>
            ) : <p className="text-sm text-muted-foreground">No contact linked.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-y-3 text-sm md:grid-cols-4">
            <dt className="text-muted-foreground">Salesperson</dt>
            <dd>{opportunity.salesperson ?? "—"}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDateTime(opportunity.created_at)}</dd>
            {opportunity.status_comment && (
              <>
                <dt className="text-muted-foreground">Status comment</dt>
                <dd className="col-span-3">{opportunity.status_comment}</dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">Tasks</h2>
          <TasksTab entityType="opportunity" entityId={id} tasks={tasks} members={members} currentUserId={currentUser?.id ?? ""} />
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">Notes</h2>
          <NotesTab entityType="opportunity" entityId={id} notes={notes} />
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Comments ({comments.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          ) : (
            comments.map(c => (
              <div key={c.id} className="rounded-md border p-3">
                <p className="text-sm">{c.comment}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(c.created_at)}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
