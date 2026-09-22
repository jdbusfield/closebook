import { redirect } from "next/navigation";

/** /budget/payroll lands on next year's plan, the one being built. */
export default function PayrollPlanIndex() {
  redirect(`/budget/payroll/${new Date().getFullYear() + 1}`);
}
