import Link from "next/link";
import {
  Building2,
  Plus,
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getUserEntities, getUserOrganization } from "@/lib/db/queries/organizations";
import { createClient } from "@/lib/supabase/server";
import { FinancialOverview } from "@/components/dashboard/financial-overview";
import { getReportingPeriod } from "@/lib/utils/dates";

async function getEntityCloseStatus(entityIds: string[]) {
  if (entityIds.length === 0) return {};

  const supabase = await createClient();
  const { data: periods } = await supabase
    .from("close_periods")
    .select("entity_id, status, period_year, period_month")
    .in("entity_id", entityIds)
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false });

  const statusByEntity: Record<
    string,
    { status: string; year: number; month: number } | null
  > = {};

  for (const entityId of entityIds) {
    const latestPeriod = periods?.find((p) => p.entity_id === entityId);
    statusByEntity[entityId] = latestPeriod
      ? {
          status: latestPeriod.status,
          year: latestPeriod.period_year,
          month: latestPeriod.period_month,
        }
      : null;
  }

  return statusByEntity;
}

function CloseStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "closed":
    case "locked":
      return (
        <Badge variant="default" className="gap-1">
          <CheckCircle2 className="h-3 w-3" />
          Closed
        </Badge>
      );
    case "in_progress":
    case "review":
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3" />
          In Progress
        </Badge>
      );
    case "open":
      return (
        <Badge variant="outline" className="gap-1">
          <AlertCircle className="h-3 w-3" />
          Open
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default async function DashboardPage() {
  const [entities, orgData] = await Promise.all([
    getUserEntities(),
    getUserOrganization(),
  ]);

  const closeStatus = await getEntityCloseStatus(entities.map((e) => e.id));
  // Prior month stays out of the trailing-12 view until the 20th (close in progress).
  const { year: currentYear, month: currentMonth } = getReportingPeriod();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          {orgData && (
            <p className="text-muted-foreground">
              {orgData.organization.name}
            </p>
          )}
        </div>
        <Link href="/settings">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Entity
          </Button>
        </Link>
      </div>

      {entities.length > 0 && orgData && (
        <FinancialOverview
          scope="organization"
          organizationId={orgData.organization.id}
          currentYear={currentYear}
          currentMonth={currentMonth}
          title="Consolidated — Trailing 12-Month Performance"
        />
      )}

      {entities.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Entities Yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create your first entity to start managing month-end close
              processes.
            </p>
            <Link href="/settings">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Create Entity
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {entities.map((entity) => {
            const status = closeStatus[entity.id];
            const monthNames = [
              "Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
            ];

            return (
              <Link key={entity.id} href={`/${entity.id}/dashboard`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{entity.name}</CardTitle>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <CardDescription>{entity.code}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">
                        {status ? (
                          <span>
                            {monthNames[status.month - 1]} {status.year}
                          </span>
                        ) : (
                          <span>No close periods</span>
                        )}
                      </div>
                      {status && <CloseStatusBadge status={status.status} />}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
