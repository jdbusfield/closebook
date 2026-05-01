import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChevronLeft } from "lucide-react";
import { getAllSlugs, getPage, getSections } from "@/lib/wiki/loader";
import { renderMarkdown } from "@/lib/wiki/markdown";

export const dynamic = "force-static";

export async function generateStaticParams() {
  const slugs = await getAllSlugs();
  return slugs
    .filter((slug) => slug !== "index")
    .map((slug) => ({ slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function WikiPage({ params }: PageProps) {
  const { slug } = await params;
  const [page, sections] = await Promise.all([
    getPage(slug),
    getSections(),
  ]);

  if (!page) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/settings/wiki"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back to Wiki
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {page.section}
            </p>
            <CardTitle className="text-2xl">{page.title}</CardTitle>
            {page.description ? (
              <CardDescription>{page.description}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>{renderMarkdown(page.content)}</CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">All pages</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {sections.map((s) => (
                <div key={s.section}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {s.section}
                  </p>
                  <ul className="space-y-1">
                    {s.pages.map((p) => {
                      const active = p.slug === page.slug;
                      const href =
                        p.slug === "index"
                          ? "/settings/wiki"
                          : `/settings/wiki/${p.slug}`;
                      return (
                        <li key={p.slug}>
                          <Link
                            href={href}
                            className={
                              "text-sm underline-offset-4 hover:underline " +
                              (active
                                ? "font-semibold text-foreground"
                                : "text-primary")
                            }
                          >
                            {p.title}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
