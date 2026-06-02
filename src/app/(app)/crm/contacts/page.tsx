import Link from "next/link";
import { Users, Search } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCrmContacts } from "@/lib/db/queries/crm";
import { formatDate } from "../_components/crm-shared";

interface PageProps {
  searchParams: Promise<{ q?: string; role?: string; status?: string }>;
}

export default async function ContactsListPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const contacts = await getCrmContacts({ search: sp.q, role: sp.role, status: sp.status });

  // Build a unique role list from the data, capped
  const roleSet = new Set<string>();
  contacts.forEach(c => c.role && roleSet.add(c.role));
  const roles = Array.from(roleSet).sort();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Users className="h-6 w-6" /> Contacts
        </h1>
        <p className="text-sm text-muted-foreground">{contacts.length} contacts</p>
      </div>

      <Card>
        <CardHeader>
          <CardDescription>Filters</CardDescription>
          <form className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input name="q" defaultValue={sp.q ?? ""} placeholder="Name or email" className="pl-8" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Role</label>
              <select name="role" defaultValue={sp.role ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
                <option value="">All roles</option>
                {roles.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
              <select name="status" defaultValue={sp.status ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <Button type="submit" size="sm">Apply</Button>
            {(sp.q || sp.role || sp.status) && (
              <Button asChild type="button" variant="ghost" size="sm">
                <Link href="/crm/contacts">Clear</Link>
              </Button>
            )}
          </form>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Role</th>
                  <th className="px-4 py-2 text-left">Company</th>
                  <th className="px-4 py-2 text-left">Email</th>
                  <th className="px-4 py-2 text-left">Phone</th>
                  <th className="px-4 py-2 text-left">Salesperson</th>
                  <th className="px-4 py-2 text-left">Last contact</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {contacts.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No contacts found.</td></tr>
                ) : (
                  contacts.map(c => (
                    <tr key={c.id} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/crm/contacts/${c.id}`} className="hover:underline">{c.name}</Link>
                      </td>
                      <td className="px-4 py-2">{c.role}</td>
                      <td className="px-4 py-2">
                        {c.company ? (
                          <Link href={`/crm/companies/${c.company.id}`} className="text-muted-foreground hover:underline">
                            {c.company.name}
                          </Link>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{c.email ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{c.phone ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{c.salesperson ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {c.last_contact_date ? `${formatDate(c.last_contact_date)}${c.last_contact_type ? ` · ${c.last_contact_type}` : ""}` : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={c.status === "active" ? "secondary" : "outline"} className="text-xs">
                          {c.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
