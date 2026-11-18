import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmailSendDialog } from "@/components/email-send-dialog";
import { buildApprovalSheet, hoursText } from "./timesheet-approval";
import { generateTimesheetPdf } from "./timesheet-pdf";
import { updateTimesheet, type Timesheet } from "./timesheet-store";

export function TimesheetApprovalDialog({
  open,
  onOpenChange,
  sheet,
  onStatus,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheet: Timesheet;
  onStatus: (status: "approved" | "rejected") => void;
  onSent: (recipients: string[]) => void;
}) {
  const approval = buildApprovalSheet(sheet);
  const partyLabel = sheet.side === "customer" ? "Customer" : "Vendor";
  const pillClass = approval.status === "Approved"
    ? "bg-emerald-50 text-emerald-700"
    : approval.status === "Rejected"
      ? "bg-red-50 text-red-700"
      : "bg-orange-50 text-orange-700";

  function setStatus(status: "approved" | "rejected") {
    approval.ids.forEach((id) => updateTimesheet(id, { status }));
    onStatus(status);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <div className="max-h-[85vh] overflow-y-auto bg-[#F8FAFC] p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#111827]">{partyLabel} Timesheet Approval</h2>
              <p className="mt-1 text-sm text-[#6B7280]">{partyLabel} కి timesheet పంపించి approval తీసుకోవాలి.</p>
            </div>
            <EmailSendDialog
              defaultTo={sheet.partyEmail}
              defaultSubject={`${partyLabel} Timesheet Approval`}
              defaultBody={`Dear ${sheet.partyName || "Sir/Madam"},\n\nPlease find the timesheet approval for ${approval.periodLabel}.\n\nThank you.`}
              pdfFilename={`${partyLabel}-Timesheet-Approval.pdf`}
              generatePdf={() => generateTimesheetPdf(sheet, "", { returnBase64: true }) as Promise<string>}
              triggerSize="sm"
              triggerLabel={`Send to ${partyLabel}`}
              onSuccess={onSent}
            />
          </div>

          <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold text-[#111827]">Timesheet Approval</h3>
            <div className="mt-4 space-y-3 border-b border-[#E5E7EB] pb-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#6B7280]">{partyLabel}</span>
                <span className="font-medium text-[#111827]">{approval.partyName}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#6B7280]">Period</span>
                <span className="font-semibold text-[#111827]">{approval.periodLabel}</span>
              </div>
            </div>

            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-[#6B7280]">
                  <th className="py-3 text-left font-medium">Employee</th>
                  <th className="py-3 text-right font-medium">Normal Hrs</th>
                  <th className="py-3 text-right font-medium">OT Hrs</th>
                </tr>
              </thead>
              <tbody>
                {approval.rows.map((row) => (
                  <tr key={row.name} className="border-b border-[#F1F5F9]">
                    <td className="py-3 text-[#111827]">{row.name}</td>
                    <td className="py-3 text-right text-[#111827]">{hoursText(row.normal)}</td>
                    <td className="py-3 text-right text-[#111827]">{hoursText(row.overtime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-5 space-y-3">
              <div>
                <p className="text-sm font-semibold text-[#111827]">Total Normal Hours</p>
                <p className="text-lg font-semibold text-[#111827]">{hoursText(approval.totalNormal)}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#111827]">Total OT Hours</p>
                <p className="text-lg font-semibold text-[#111827]">{hoursText(approval.totalOt)}</p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <span className="text-sm text-[#6B7280]">{partyLabel} Approval</span>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${pillClass}`}>{approval.status}</span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setStatus("approved")}
                className="rounded-full bg-[#16A34A] px-4 py-2.5 text-sm font-semibold text-white"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => setStatus("rejected")}
                className="rounded-full border border-[#F87171] bg-white px-4 py-2.5 text-sm font-semibold text-[#EF4444]"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
