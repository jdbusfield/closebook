import { CheckSquare } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyOpenTasks } from "@/lib/db/queries/crm-tasks";
import { createClient } from "@/lib/supabase/server";
import { MyTaskList } from "../_components/tasks-tab";

export default async function MyTasksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Please sign in.</p>
      </div>
    );
  }
  const tasks = await getMyOpenTasks(user.id);
  const overdueCount = tasks.filter(t => t.is_overdue).length;
  const todayKey = new Date().toISOString().slice(0, 10);
  const dueTodayCount = tasks.filter(t => t.due_date === todayKey).length;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <CheckSquare className="h-6 w-6" /> My open tasks
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tasks assigned to you across all CRM entities. Overdue tasks are highlighted in red.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Open</p>
            <p className="mt-1 text-2xl font-semibold">{tasks.length}</p>
          </CardContent>
        </Card>
        <Card className={overdueCount > 0 ? "border-rose-300" : undefined}>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Overdue</p>
            <p className={`mt-1 text-2xl font-semibold ${overdueCount > 0 ? "text-rose-700" : ""}`}>{overdueCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Due today</p>
            <p className="mt-1 text-2xl font-semibold">{dueTodayCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
          <CardDescription>Sorted by due date, soonest first.</CardDescription>
        </CardHeader>
        <CardContent>
          <MyTaskList tasks={tasks} />
        </CardContent>
      </Card>
    </div>
  );
}
