import { useEffect, useState } from "react";
import { Download, Printer, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EmailSendDialog } from "@/components/email-send-dialog";
import { buildApprovalSheet, hoursText } from "./timesheet-approval";
import { generateTimesheetPdf } from "./timesheet-pdf";
import { updateTimesheet, type Timesheet } from "./timesheet-store";
import { confirmTimesheetAck, createTimesheetAck } from "./timesheet-ack-api";

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
  const [ackToken, setAckToken] = useState(sheet.approvalToken || "");
  const [approveUrl, setApproveUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const partyLabel = sheet.side === "customer" ? "Customer" : "Vendor";
  const pillClass = approval.status === "Approved"
    ? "bg-emerald-50 text-emerald-700"
    : approval.status === "Rejected"
      ? "bg-red-50 text-red-700"
      : "bg-orange-50 text-orange-700";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const created = await createTimesheetAck(sheet);
      if (!cancelled && created?.token) {
        setAckToken(created.token);
        setApproveUrl(created.approveUrl || `${window.location.origin}/api/timesheet-ack/${created.token}/approve`);
        approval.ids.forEach((id) => updateTimesheet(id, { approvalToken: created.token }));
      }
    })();
    return () => { cancelled = true; };
  }, [sheet.id, open]);

  async function approve() {
    if (busy || approval.status === "Approved") return;
    setBusy(true);
    try {
      approval.ids.forEach((id) => updateTimesheet(id, { status: "approved", approvalToken: ackToken || sheet.approvalToken }));
      await confirmTimesheetAck(sheet, "confirmed");
      onStatus("approved");
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdf() {
    await (async () => {
      let url = approveUrl;
      let token = ackToken || sheet.approvalToken || "";
      if (!url || !token) {
        const created = await createTimesheetAck(sheet);
        if (created?.token) {
          token = created.token;
          url = created.approveUrl || `${window.location.origin}/api/timesheet-ack/${created.token}/approve`;
          setAckToken(created.token);
          setApproveUrl(url);
        }
      }
      await generateTimesheetPdf({ ...sheet, approvalToken: token }, "", { returnBase64: false, approveUrl: url || undefined });
    })();
  }

  async function printPdf() {
    const base64 = await generateTimesheetPdf(sheet, "", { returnBase64: true, approveUrl: approveUrl || undefined }) as string;
    if (!base64) return;
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;width:0;height:0;border:none;opacity:0;";
    document.body.appendChild(iframe);
    iframe.src = url;
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        try { document.body.removeChild(iframe); URL.revokeObjectURL(url); } catch {}
      }, 60000);
    };
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0 [&>button]:hidden">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-base font-semibold">Timesheet</h2>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void downloadPdf()}>
              <Download className="h-4 w-4" /> Download
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void printPdf()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <EmailSendDialog
              defaultTo={sheet.partyEmail}
              defaultSubject={`${partyLabel} Timesheet Approval`}
              defaultBody={`Dear ${sheet.partyName || "Sir/Madam"},\n\nPlease find the timesheet approval for ${approval.periodLabel}.\n\nThank you.`}
              pdfFilename={`${partyLabel}-Timesheet-Approval.pdf`}
              generatePdf={async () => {
                let url = approveUrl;
                let token = ackToken || sheet.approvalToken || "";
                if (!url || !token) {
                  const created = await createTimesheetAck(sheet);
                  if (created?.token) {
                    token = created.token;
                    url = created.approveUrl || `${window.location.origin}/api/timesheet-ack/${created.token}/approve`;
                    setAckToken(created.token);
                    setApproveUrl(url);
                    updateTimesheet(sheet.id, { approvalToken: created.token });
                  }
                }
                return generateTimesheetPdf(
                  { ...sheet, approvalToken: token || sheet.approvalToken },
                  "",
                  { returnBase64: true, approveUrl: url || undefined },
                ) as Promise<string>;
              }}
              triggerSize="sm"
              timesheetAckToken={ackToken || sheet.approvalToken}
              triggerDisabled={!ackToken && !sheet.approvalToken}
              onSuccess={onSent}
            />
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenChange(false)} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="max-h-[85vh] overflow-y-auto bg-[#F8FAFC] p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[#111827]">{partyLabel} Timesheet Approval</h2>
            <p className="mt-1 text-sm text-[#6B7280]">{partyLabel} ki timesheet pampinchi approval teesukovali.</p>
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

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-[#6B7280]">{partyLabel} Approval</span>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${pillClass}`}>{approval.status}</span>
            </div>

            {approval.status === "Pending" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void approve()}
                className="mt-4 w-full rounded-lg bg-[#16A34A] px-4 py-3 text-sm font-semibold text-white hover:bg-[#15803D] disabled:opacity-60"
              >
                {busy ? "Saving..." : "Approved"}
              </button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}