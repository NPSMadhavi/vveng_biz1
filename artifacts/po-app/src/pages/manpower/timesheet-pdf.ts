import { jsPDF } from "jspdf";
import { buildApprovalSheet, hoursText } from "./timesheet-approval";
import type { Timesheet } from "./timesheet-store";

export async function generateTimesheetPdf(
  sheet: Timesheet,
  _companyName: string,
  options?: { returnBase64?: boolean },
): Promise<string | void> {
  const approval = buildApprovalSheet(sheet);
  const partyLabel = sheet.side === "customer" ? "Customer" : "Vendor";
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const left = 16;
  const right = 194;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`${partyLabel} Timesheet Approval`, left, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(`${partyLabel} ki timesheet pampinchi approval teesukovali.`, left, 28);
  doc.setTextColor(0, 0, 0);

  const boxHeight = 118 + approval.rows.length * 8;
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(left, 36, right - left, boxHeight, 3, 3);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Timesheet Approval", left + 6, 46);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text(partyLabel, left + 6, 58);
  doc.text("Period", left + 6, 66);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.text(approval.partyName, right - 6, 58, { align: "right" });
  doc.text(approval.periodLabel, right - 6, 66, { align: "right" });

  let y = 78;
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
  doc.setTextColor(approval.status === "Approved" ? 22 : approval.status === "Rejected" ? 185 : 180, approval.status === "Approved" ? 120 : approval.status === "Rejected" ? 28 : 90, approval.status === "Approved" ? 70 : approval.status === "Rejected" ? 28 : 20);
  doc.text(approval.status, right - 6, y, { align: "right" });

  const filename = `${sheet.side === "customer" ? "Customer" : "Vendor"}-Timesheet-Approval.pdf`;
  if (options?.returnBase64) {
    const uri = doc.output("datauristring");
    return uri.split(",")[1] || "";
  }
  doc.save(filename);
}
