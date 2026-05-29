import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, type InquiryStatus } from "@/lib/inquiries/shared";

const STATUS_STYLES: Record<InquiryStatus, string> = {
  new: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  quote_sent: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  rental_confirmed: "bg-violet-100 text-violet-800 hover:bg-violet-100",
  completed: "bg-green-100 text-green-800 hover:bg-green-100",
  lost: "bg-gray-200 text-gray-700 hover:bg-gray-200",
};

export function StatusBadge({ status }: { status: string }) {
  const key = (status in STATUS_LABELS ? status : "new") as InquiryStatus;
  return (
    <Badge variant="outline" className={STATUS_STYLES[key]}>
      {STATUS_LABELS[key]}
    </Badge>
  );
}
