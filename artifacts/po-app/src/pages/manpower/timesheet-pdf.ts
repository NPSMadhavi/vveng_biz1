import { jsPDF } from "jspdf";
import { buildApprovalSheet, hoursText } from "./timesheet-approval";
import type { Timesheet } from "./timesheet-store";

function resolveApproveUrl(sheet: Timesheet, approveUrl?: string) {
  if (approveUrl) return approveUrl;
  const token = sheet.approvalToken;
  if (!token || typeof window === "undefined") return "";
  return `${window.location.origin}/api/timesheet-ack/${token}/approve`;
}

export async function generateTimesheetPdf(
  sheet: Timesheet,
  _companyName: string,
  options?: { returnBase64?: boolean; approveUrl?: string },
): Promise<string | void> {
  const approval = buildApprovalSheet(sheet);
  const partyLabel = sheet.side === "customer" ? "Customer" : "Vendor";
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const left = 16;
  const right = 194;
  const approveUrl = resolveApproveUrl(sheet, options?.approveUrl);
  // Always show Approved button on the sheet while Pending
  const showApproveBtn = approval.status === "Pending";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`${partyLabel} Timesheet Approval`, left, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(`${partyLabel} ki timesheet pampinchi approval teesukovali.`, left, 28);
  doc.setTextColor(0, 0, 0);

  // Draw content first, then border around full content including button
  const boxTop = 36;
  let y = 46;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Timesheet Approval", left + 6, y);

  y = 58;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text(partyLabel, left + 6, y);
  doc.text("Period", left + 6, y + 8);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.text(approval.partyName, right - 6, y, { align: "right" });
  doc.text(approval.periodLabel, right - 6, y + 8, { align: "right" });

  y = 78;
  doc.setFont("helvetica", "bold");
  doc.text("Employee", left + 6, y);
  doc.text("Normal Hrs", 120, y, { align: "right" });
  doc.text("OT Hrs", right - 6, y, { align: "right" });
  y += 4;
  doc.setDrawColor(226, 232, 240);
  doc.line(left + 6, y, right - 6, y);

  doc.setFont("helvetica", "normal");
  approval.rows.forEach((row) => {
    y += 8;
    doc.text(row.name, left + 6, y);
    doc.text(hoursText(row.normal), 120, y, { align: "right" });
    doc.text(hoursText(row.overtime), right - 6, y, { align: "right" });
  });

  y += 10;
  doc.line(left + 6, y, right - 6, y);
  y += 10;
  doc.setFont("helvetica", "bold");
  doc.text("Total Normal Hours", left + 6, y);
  y += 6;
  doc.setFontSize(14);
  doc.text(hoursText(approval.totalNormal), left + 6, y);
  y += 10;
  doc.setFontSize(10);
  doc.text("Total OT Hours", left + 6, y);
  y += 6;
  doc.setFontSize(14);
  doc.text(hoursText(approval.totalOt), left + 6, y);
  y += 12;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text(`${partyLabel} Approval`, left + 6, y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(
    approval.status === "Approved" ? 22 : approval.status === "Rejected" ? 185 : 180,
    approval.status === "Approved" ? 120 : approval.status === "Rejected" ? 28 : 90,
    approval.status === "Approved" ? 70 : approval.status === "Rejected" ? 28 : 20,
  );
  doc.text(approval.status, right - 6, y, { align: "right" });

  if (showApproveBtn) {
    y += 8;
    const btnX = left + 6;
    const btnW = right - left - 12;
    const btnH = 14;
    doc.setFillColor(22, 163, 74);
    doc.roundedRect(btnX, y, btnW, btnH, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Approved", btnX + btnW / 2, y + 9.5, { align: "center" });
    if (approveUrl) {
      doc.link(btnX, y, btnW, btnH, { url: approveUrl });
    }
    y += btnH;
  }

  const boxHeight = y - boxTop + 10;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.roundedRect(left, boxTop, right - left, boxHeight, 3, 3);

  const filename = `${sheet.side === "customer" ? "Customer" : "Vendor"}-Timesheet-Approval.pdf`;
  if (options?.returnBase64) {
    const uri = doc.output("datauristring");
    return uri.split(",")[1] || "";
  }
  doc.save(filename);
}