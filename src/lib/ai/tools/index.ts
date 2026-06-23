import { getEntities } from "./get_entities";
import { getIncomeStatement } from "./get_income_statement";
import { getTrialBalance } from "./get_trial_balance";
import { getDebtSummary } from "./get_debt_summary";
import { listRentalAssets } from "./list_rental_assets";
import { getCloseStatus } from "./get_close_status";
import { searchChartOfAccounts } from "./search_chart_of_accounts";
import { getRebateTracker } from "./get_rebate_tracker";
import type { AiTool } from "./types";

export const TOOLS: AiTool[] = [
  getEntities,
  getIncomeStatement,
  searchChartOfAccounts,
  getTrialBalance,
  getDebtSummary,
  listRentalAssets,
  getCloseStatus,
  getRebateTracker,
];

export const TOOL_BY_NAME: Record<string, AiTool> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t]),
);

export type { AiTool, ToolContext } from "./types";
