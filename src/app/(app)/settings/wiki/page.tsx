import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BookOpen } from "lucide-react";
import { getSections, getPage } from "@/lib/wiki/loader";
import { renderMarkdown } from "@/lib/wiki/markdown";

export const dynamic = "force-static";

export default async function WikiIndexPage() {
  const [sections, indexPage] = await Promise.all([
    getSections(),
    getPage("index"),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <BookOpen className="h-6 w-6" />
            Wiki
          </h1>
          <p className="text-muted-foreground">
            Closebook&rsquo;s living documentation. Sourced from{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              docs/wiki/
            </code>{" "}
            in the repository.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardContent className="pt-6">
            {indexPage ? (
              renderMarkdown(indexPage.content)
            ) : (
              <p className="text-sm text-muted-foreground">
                No index page found. Add{" "}
                <code className="rounded bg-muted px-1 py-0.5">
                  docs/wiki/index.md
                </code>{" "}
                to populate this section.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">All pages</CardTitle>
              <CardDescription>
                Browse the wiki by section.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {sections.map((s) => (
                <div key={s.section}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {s.section}
                  </p>
                  <ul className="space-y-1">
                    {s.pages.map((p) => (
                      <li key={p.slug}>
                        <Link
                          href={
                            p.slug === "index"
                              ? "/settings/wiki"
                              : `/settings/wiki/${p.slug}`
                          }
                          className="text-sm text-primary underline-offset-4 hover:underline"
                        >
                          {p.title}
                        </Link>
                        {p.description ? (
                          <p className="text-xs text-muted-foreground">
                            {p.description}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {sections.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No wiki pages found yet.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
