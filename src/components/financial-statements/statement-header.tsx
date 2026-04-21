"use client";

import Image from "next/image";
import { getStatementPeriodDescription } from "./format-utils";
import type { Granularity } from "./types";

/** Map company/reporting entity names (lowercased) to logo paths */
const ENTITY_LOGOS: Record<string, string> = {
  "silverco enterprises": "/logos/silverco.svg",
  "avon": "/logos/silverco.svg",
  "versatile studios": "/logos/versatile-studios.svg",
  "versatile": "/logos/versatile-studios.svg",
  "hollywood depot rentals": "/logos/hollywood-depot-rentals.jpg",
  "hollywood depot": "/logos/hollywood-depot-rentals.jpg",
  "hdr": "/logos/hollywood-depot-rentals.jpg",
};

function getLogoForEntity(companyName: string): string | null {
  const key = companyName.toLowerCase().trim();
  return ENTITY_LOGOS[key] ?? null;
}

interface StatementHeaderProps {
  companyName: string;
  statementTitle: string;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: Granularity;
  unaudited?: boolean;
}

export function StatementHeader({
  companyName,
  statementTitle,
  startYear,
  startMonth,
  endYear,
  endMonth,
  granularity,
  unaudited = true,
}: StatementHeaderProps) {
  const periodDescription = getStatementPeriodDescription(
    startYear,
    startMonth,
    endYear,
    endMonth,
    granularity
  );

  const logo = getLogoForEntity(companyName);

  return (
    <div className="stmt-header text-center py-4 space-y-0.5">
      {logo ? (
        <div className="flex justify-center py-1">
          <Image
            src={logo}
            alt={companyName}
            width={160}
            height={28}
            className="h-7 w-auto object-contain"
            priority
          />
        </div>
      ) : (
        <div className="text-sm font-bold uppercase tracking-wide">
          {companyName}
        </div>
      )}
      <div className="text-sm font-bold uppercase tracking-wide">
        {statementTitle}
      </div>
      <div className="text-xs text-muted-foreground italic">
        {periodDescription}
      </div>
    </div>
  );
}
