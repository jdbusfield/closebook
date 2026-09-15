import { VersionShell } from "./version-shell";

export default async function BudgetVersionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = await params;
  return <VersionShell versionId={versionId}>{children}</VersionShell>;
}
