import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  FileText,
  TableProperties,
} from "lucide-react";
import { getCurrentPeriod, getPeriodLabel, getReportingPeriod } from "@/lib/utils/dates";
import { LastMonthPerformance } from "@/components/dashboard/last-month-performance";
import { ThisMonthProjection } from "@/components/dashboard/this-month-projection";
import { DriftAlertBanner } from "@/components/dashboard/drift-alerts";
import { FinancialOverview } from "@/components/dashboard/financial-overview";

async function getEntityDashboardData(entityId: string) {
  const supabase = await createClient();

  const [entityResult, periodResult, connectionResult] = await Promise.all([
    supabase.from("entities").select("*").eq("id", entityId).single(),
    supabase
      .from("close_periods")
      .select("*")
      .eq("entity_id", entityId)
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("qbo_connections")
      .select("company_name, last_sync_at, sync_status, sync_error")
      .eq("entity_id", entityId)
      .single(),
  ]);

  // Fetch active drift alerts
  const { data: driftAlertsRaw } = await supabase
    .from("drift_alerts")
    .select("*, accounts!inner(name, account_number, account_type, classification)")
    .eq("entity_id", entityId)
    .eq("is_dismissed", false)
    .order("created_at", { ascending: false })
    .limit(50);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const driftAlerts = (driftAlertsRaw ?? []) as any[];

  let taskStats = null;
  if (periodResult.data) {
    const { data: tasks } = await supabase
      .from("close_tasks")
      .select("status")
      .eq("close_period_id", periodResult.data.id);

    if (tasks) {
      const total = tasks.length;
      const completed = tasks.filter(
        (t) => t.status === "approved" || t.status === "na"
      ).length;
      const inProgress = tasks.filter(
        (t) => t.status === "in_progress"
      ).length;
      const pendingReview = tasks.filter(
        (t) => t.status === "pending_review"
      ).length;

      taskStats = {
        total,
        completed,
        inProgress,
        pendingReview,
        percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    }
  }

  return {
    entity: entityResult.data,
    currentPeriod: periodResult.data,
    connection: connectionResult.data,
    taskStats,
    driftAlerts: driftAlerts ?? [],
  };
}

export default async function EntityDashboardPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const { entity, currentPeriod, connection, taskStats, driftAlerts } =
    await getEntityDashboardData(entityId);

  if (!entity) notFound();

  const { year: currentYear, month: currentMonth } = getCurrentPeriod();
  // Trailing-12 hero holds the prior month back until the 20th (close in progress).
  const { year: reportingYear, month: reportingMonth } = getReportingPeriod();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {entity.name}
        </h1>
        <p className="text-muted-foreground">{entity.code}</p>
      </div>

      {/* Drift Alert Banner */}
      {driftAlerts.length > 0 && (
        <DriftAlertBanner entityId={entityId} initialAlerts={driftAlerts} />
      )}

      {/* Trailing 12-Month Performance — hero section */}
      <FinancialOverview
        scope="entity"
        entityId={entityId}
        currentYear={reportingYear}
        currentMonth={reportingMonth}
      />

      {/* Financial Performance Section */}
      <div className="grid gap-4 lg:grid-cols-2">
        <LastMonthPerformance
          entityId={entityId}
          currentYear={currentYear}
          currentMonth={currentMonth}
        />
        <ThisMonthProjection
          entityId={entityId}
          currentYear={currentYear}
          currentMonth={currentMonth}
        />
      </div>

      {/* Status Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Close Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Close Status</CardDescription>
            <CardTitle className="text-lg">
              {currentPeriod
                ? getPeriodLabel(
                    currentPeriod.period_year,
                    currentPeriod.period_month
                  )
                : "No Active Period"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {taskStats ? (
              <div className="space-y-2">
                <Progress value={taskStats.percentage} className="h-2" />
                <p className="text-sm text-muted-foreground">
                  {taskStats.completed}/{taskStats.total} tasks complete
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Initialize a close period to get started
              </p>
            )}
          </CardContent>
        </Card>

        {/* Tasks Summary */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tasks</CardDescription>
            <CardTitle className="text-lg">
              {taskStats ? (
                <div className="flex gap-3 text-base">
                  <span className="flex items-center gap-1">
                    <Clock className="h-4 w-4 text-yellow-500" />
                    {taskStats.inProgress}
                  </span>
                  <span className="flex items-center gap-1">
                    <AlertCircle className="h-4 w-4 text-blue-500" />
                    {taskStats.pendingReview}
                  </span>
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    {taskStats.completed}
                  </span>
                </div>
              ) : (
                "---"
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {currentPeriod && (
              <Link href={`/${entityId}/close/${currentPeriod.id}`}>
                <Button variant="outline" size="sm" className="w-full">
                  View Tasks
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>

        {/* QBO Connection */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>QuickBooks</CardDescription>
            <CardTitle className="text-lg">
              {connection ? connection.company_name ?? "Connected" : "Not Connected"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {connection ? (
              <div className="space-y-1">
                <Badge
                  variant={
                    connection.sync_status === "error"
                      ? "destructive"
                      : "outline"
                  }
                >
                  <RefreshCw className="mr-1 h-3 w-3" />
                  {connection.sync_status === "syncing"
                    ? "Syncing..."
                    : connection.sync_status === "error"
                    ? "Error"
                    : "Synced"}
                </Badge>
                {connection.last_sync_at && (
                  <p className="text-xs text-muted-foreground">
                    Last: {new Date(connection.last_sync_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            ) : (
              <Link href={`/${entityId}/settings`}>
                <Button variant="outline" size="sm" className="w-full">
                  Connect QBO
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Quick Actions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href={`/${entityId}/close`} className="block">
              <Button variant="outline" size="sm" className="w-full justify-start">
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Close Management
              </Button>
            </Link>
            <Link href={`/${entityId}/reports`} className="block">
              <Button variant="outline" size="sm" className="w-full justify-start">
                <FileText className="mr-2 h-4 w-4" />
                Reports
              </Button>
            </Link>
            <Link href={`/${entityId}/schedules`} className="block">
              <Button variant="outline" size="sm" className="w-full justify-start">
                <TableProperties className="mr-2 h-4 w-4" />
                Schedules
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
