import { Router } from "express";
import {
  findApprovalByToken,
  findApprovalsByIds,
  markTimesheetApproval,
  markTimesheetApprovalByIds,
  upsertTimesheetApproval,
  type TimesheetApprovalRecord,
} from "../lib/timesheet-approvals-store.js";

const router = Router();

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hoursText(value: number) {
  return String(Math.round((Number(value) || 0) * 100) / 100);
}

function renderPage(title: string, heading: string, body: string, color: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; background: #f4f6f9; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); max-width: 520px; width: 100%; overflow: hidden; }
  .header { background: ${color}; padding: 28px 32px; text-align: center; }
  .header h1 { color: white; font-size: 20px; font-weight: 700; }
  .body { padding: 32px; }
  .icon { font-size: 48px; text-align: center; margin-bottom: 16px; }
  .msg { font-size: 15px; color: #444; line-height: 1.6; text-align: center; }
  .footer { padding: 0 32px 24px; text-align: center; color: #aaa; font-size: 12px; }
</style>
</head>
<body>
<div class="card">
  <div class="header"><h1>BizOne° Document Portal</h1></div>
  <div class="body">
    <div class="icon">${heading}</div>
    <p class="msg">${body}</p>
  </div>
  <div class="footer">Powered by bizOneSG &ndash; Smarter Accounting. Better Business.</div>
</div>
</body>
</html>`;
}

function partyLabel(side: TimesheetApprovalRecord["side"]) {
  return side === "customer" ? "Customer" : "Vendor";
}

function statusLabel(status: TimesheetApprovalRecord["status"]) {
  if (status === "confirmed") return "Confirmed";
  if (status === "rejected") return "Rejected";
  return "Pending";
}

function publicBase(req: { get: (name: string) => string | undefined }) {
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost";
  const proto = req.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

// Auth: create / refresh approval packet for email link
router.post("/timesheet-ack", async (req, res): Promise<void> => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const companyId = Number((req.session as any).companyId);
  if (!companyId) {
    res.status(400).json({ error: "No active company selected" });
    return;
  }

  const side = req.body?.side === "supplier" ? "supplier" : "customer";
  const timesheetIds = Array.isArray(req.body?.timesheetIds)
    ? req.body.timesheetIds.map((id: unknown) => String(id)).filter(Boolean)
    : [];
  if (!timesheetIds.length) {
    res.status(400).json({ error: "timesheetIds required" });
    return;
  }

  const rows = Array.isArray(req.body?.rows)
    ? req.body.rows.map((row: any) => ({
        name: String(row?.name || "Employee"),
        normal: Number(row?.normal) || 0,
        overtime: Number(row?.overtime) || 0,
      }))
    : [];

  const record = upsertTimesheetApproval({
    companyId,
    side,
    partyName: String(req.body?.partyName || "—"),
    partyEmail: String(req.body?.partyEmail || ""),
    periodLabel: String(req.body?.periodLabel || ""),
    rows,
    totalNormal: Number(req.body?.totalNormal) || rows.reduce((sum: number, row: any) => sum + row.normal, 0),
    totalOt: Number(req.body?.totalOt) || rows.reduce((sum: number, row: any) => sum + row.overtime, 0),
    timesheetIds,
    reuseToken: req.body?.reuseToken ? String(req.body.reuseToken) : undefined,
  });

  const url = `${publicBase(req)}/api/timesheet-ack/${record.token}`;
  res.json({
    token: record.token,
    url,
    approveUrl: `${url}/approve`,
    status: record.status,
    statusLabel: statusLabel(record.status),
  });
});

// Auth: sync statuses for timesheet ids
router.get("/timesheet-ack/status", async (req, res): Promise<void> => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const companyId = Number((req.session as any).companyId);
  if (!companyId) {
    res.status(400).json({ error: "No active company selected" });
    return;
  }
  const ids = String(req.query.ids || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const matches = findApprovalsByIds(companyId, ids);
  const byId: Record<string, { status: string; statusLabel: string; token: string; confirmedAt?: string }> = {};
  for (const record of matches) {
    for (const id of record.timesheetIds) {
      byId[id] = {
        status: record.status,
        statusLabel: statusLabel(record.status),
        token: record.token,
        confirmedAt: record.confirmedAt,
      };
    }
  }
  res.json({ byId });
});

// Auth: staff manual confirm / reject
router.post("/timesheet-ack/confirm", async (req, res): Promise<void> => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const companyId = Number((req.session as any).companyId);
  if (!companyId) {
    res.status(400).json({ error: "No active company selected" });
    return;
  }
  const ids = Array.isArray(req.body?.timesheetIds)
    ? req.body.timesheetIds.map((id: unknown) => String(id)).filter(Boolean)
    : [];
  const status = req.body?.status === "rejected" ? "rejected" : "confirmed";
  if (!ids.length) {
    res.status(400).json({ error: "timesheetIds required" });
    return;
  }

  let record = markTimesheetApprovalByIds(companyId, ids, status, "staff");
  if (!record && req.body?.createIfMissing) {
    record = upsertTimesheetApproval({
      companyId,
      side: req.body?.side === "supplier" ? "supplier" : "customer",
      partyName: String(req.body?.partyName || "—"),
      partyEmail: String(req.body?.partyEmail || ""),
      periodLabel: String(req.body?.periodLabel || ""),
      rows: Array.isArray(req.body?.rows) ? req.body.rows : [],
      totalNormal: Number(req.body?.totalNormal) || 0,
      totalOt: Number(req.body?.totalOt) || 0,
      timesheetIds: ids,
    });
    record = markTimesheetApproval(record.token, status, "staff") || record;
  }

  res.json({
    ok: true,
    status,
    statusLabel: statusLabel(status),
    token: record?.token,
  });
});

// Public: customer opens approval document page
router.get("/timesheet-ack/:token", async (req, res): Promise<void> => {
  const record = findApprovalByToken(String(req.params.token || ""));
  if (!record) {
    res.status(404).send(renderPage("Not Found", "❌", "This timesheet approval link is invalid or has expired.", "#e53e3e"));
    return;
  }

  const label = partyLabel(record.side);
  if (record.status === "confirmed" || record.status === "rejected") {
    const when = record.confirmedAt
      ? new Date(record.confirmedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      : "";
    res.send(renderPage(
      statusLabel(record.status),
      record.status === "confirmed" ? "✅" : "❌",
      `Timesheet for <strong>${esc(record.partyName)}</strong> (${esc(record.periodLabel)}) is already <strong>${statusLabel(record.status)}</strong>${when ? ` on ${esc(when)}` : ""}.`,
      record.status === "confirmed" ? "#2e7d32" : "#c62828",
    ));
    return;
  }

  const rowsHtml = record.rows.map((row) =>
    `<tr><td>${esc(row.name)}</td><td style="text-align:right">${hoursText(row.normal)}</td><td style="text-align:right">${hoursText(row.overtime)}</td></tr>`
  ).join("") || `<tr><td colspan="3" style="text-align:center;color:#888">No hours</td></tr>`;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(label)} Timesheet Approval</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; background: #f4f6f9; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); max-width: 560px; width: 100%; overflow: hidden; }
  .header { background: linear-gradient(135deg,#0a2d6e,#1e88e5); padding: 28px 32px; text-align: center; }
  .header h1 { color: white; font-size: 20px; font-weight: 700; }
  .body { padding: 28px 32px; }
  .info { background: #f8faff; border: 1px solid #e3ecff; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; }
  .row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 14px; }
  .lbl { color: #888; } .val { font-weight: 600; color: #222; text-align: right; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px; }
  th, td { padding: 8px 4px; border-bottom: 1px solid #eef2f7; }
  th { text-align: left; color: #888; font-weight: 600; }
  .totals { font-size: 14px; margin-bottom: 20px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
  .approve { display: block; margin-top: 8px; padding: 14px 20px; background: #16a34a; color: white; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 700; text-align: center; }
  .status { text-align: center; margin-top: 12px; color: #c05600; font-size: 13px; font-weight: 600; }
  .footer { padding: 0 32px 24px; text-align: center; color: #aaa; font-size: 12px; }
</style>
</head>
<body>
<div class="card">
  <div class="header"><h1>BizOne° Document Portal</h1></div>
  <div class="body">
    <div class="info">
      <div class="row"><span class="lbl">${esc(label)}</span><span class="val">${esc(record.partyName)}</span></div>
      <div class="row"><span class="lbl">Period</span><span class="val">${esc(record.periodLabel)}</span></div>
    </div>
    <table>
      <thead><tr><th>Employee</th><th style="text-align:right">Normal Hrs</th><th style="text-align:right">OT Hrs</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="totals">
      <div><span>Total Normal Hours</span><strong>${hoursText(record.totalNormal)}</strong></div>
      <div><span>Total OT Hours</span><strong>${hoursText(record.totalOt)}</strong></div>
    </div>
    <p class="status">${esc(label)} Approval: Pending</p>
    <a class="approve" href="/api/timesheet-ack/${encodeURIComponent(record.token)}/approve">Approved</a>
  </div>
  <div class="footer">Powered by bizOneSG &ndash; Smarter Accounting. Better Business.</div>
</div>
</body>
</html>`);
});

// Public: customer clicks Approved
router.get("/timesheet-ack/:token/approve", async (req, res): Promise<void> => {
  const token = String(req.params.token || "");
  const existing = findApprovalByToken(token);
  if (!existing) {
    res.status(404).send(renderPage("Not Found", "❌", "This timesheet approval link is invalid or has expired.", "#e53e3e"));
    return;
  }
  const record = markTimesheetApproval(token, "confirmed", "customer") || existing;
  res.send(renderPage(
    "Thank You!",
    "✅",
    `Thank you! Timesheet for <strong>${esc(record.partyName)}</strong> (${esc(record.periodLabel)}) has been marked as <strong>Confirmed</strong>.`,
    "#1565c0",
  ));
});

export default router;