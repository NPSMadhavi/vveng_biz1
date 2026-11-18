import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useRoute } from "wouter";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SimpleDatePicker } from "@/components/ui/simple-date-picker";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PdfPreviewModal } from "@/components/pdf-preview-modal";
import { generateTimesheetPdf } from "./timesheet-pdf";
import { FormPageShell } from "@/operations-8june/components/layout/FormPageShell";
import {
  ModalCancelButton,
  ModalSaveButton,
  ModalSectionHeader,
} from "@/operations-8june/components/forms/FormModalShell";
import { formFieldGridClass } from "@/lib/form-ui";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useGetSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { deploymentEmployees, loadDeployments, todayIso, type DeploymentSide } from "./deployment-store";
import {
  loadTimesheets,
  removeTimesheet,
  saveTimesheet,
  updateTimesheet,
  type Timesheet,
} from "./timesheet-store";

const DAY_TYPES = ["Normal Working Day", "Rest Day", "Public Holiday", "Leave", "Absent"];
const labelClass = "text-sm font-medium text-[#111827]";

type Party = { id: number; name: string; contactEmail?: string | null };

async function fetchJson<T>(url: string): Promise<T[]> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function calcHours(timeIn: string, timeOut: string, breakHours: string) {
  if (!timeIn || !timeOut) return { normal: "", overtime: "" };
  const toMins = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return (hour || 0) * 60 + (minute || 0);
  };
  let minutes = toMins(timeOut) - toMins(timeIn);
  if (minutes < 0) minutes += 24 * 60;
  const worked = Math.max(0, minutes / 60 - (Number(breakHours) || 0));
  const normal = Math.min(worked, 8);
  const overtime = Math.max(0, worked - 8);
  const text = (value: number) => String(Math.round(value * 100) / 100);
  return { normal: text(normal), overtime: text(overtime) };
}

function isoToDate(iso: string): Date | null {
  if (!iso) return null;
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function dateToIso(date?: Date | null) {
  if (!date) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function CustomerTimesheetForm() {
  return <TimesheetForm side="customer" />;
}

export function SupplierTimesheetForm() {
  return <TimesheetForm side="supplier" />;
}

export default function TimesheetForm({ side }: { side: DeploymentSide }) {
  const [location, setLocation] = useLocation();
  const viewPattern = side === "customer"
    ? "/manpower/customers/timesheets/:id"
    : "/manpower/suppliers/timesheets/:id";
  const editPattern = side === "customer"
    ? "/manpower/customers/timesheets/:id/edit"
    : "/manpower/suppliers/timesheets/:id/edit";
  const [, viewParams] = useRoute(viewPattern);
  const [, editParams] = useRoute(editPattern);
  const params = editParams ?? viewParams;
  const isEdit = location.endsWith("/edit");
  const { selectedCompany, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const companyId = selectedCompany?.id ?? null;
  const existingId = params?.id && params.id !== "new" ? params.id : null;
  const existing = useMemo(
    () => (existingId ? loadTimesheets().find((row) => row.id === existingId && row.side === side) ?? null : null),
    [existingId, side],
  );
  const partyNoun = side === "customer" ? "Customer" : "Vendor";
  const listPath = side === "customer" ? "/manpower/customers/timesheets" : "/manpower/suppliers/timesheets";
  const partyUrl = side === "customer" ? "/api/customers" : "/api/vendors";

  const { data: parties = [] } = useQuery({
    queryKey: ["timesheet-parties", side],
    queryFn: () => fetchJson<Party>(partyUrl),
  });
  const deployments = useMemo(
    () => loadDeployments().filter((row) => row.side === side && (companyId == null || row.companyId == null || String(row.companyId) === String(companyId))),
    [side, companyId],
  );

  const runningNo = useMemo(() => {
    const prefix = String((settings as { tsPrefix?: string } | undefined)?.tsPrefix ?? "TS");
    const counter = (Number((settings as { tsCounter?: number } | undefined)?.tsCounter) || 0) + 1;
    const suffix = String((settings as { tsSuffix?: string } | undefined)?.tsSuffix ?? "");
    return { counter, value: `${prefix}${counter}${suffix}` };
  }, [settings]);

  const [timesheetNo] = useState(() => existing?.timesheetNo ?? "");
  const [deploymentId, setDeploymentId] = useState(existing?.deploymentId ?? "");
  const [employeeKey, setEmployeeKey] = useState(existing?.employeeId ?? "");
  const [workDate, setWorkDate] = useState(existing?.workDate ?? todayIso());
  const [timeIn, setTimeIn] = useState(existing?.timeIn ?? "08:00");
  const [timeOut, setTimeOut] = useState(existing?.timeOut ?? "18:00");
  const [breakHours, setBreakHours] = useState(existing?.breakHours ?? "1");
  const [normalHours, setNormalHours] = useState(existing?.normalHours ?? "8");
  const [overtimeHours, setOvertimeHours] = useState(existing?.overtimeHours ?? "1");
  const [dayType, setDayType] = useState(existing?.dayType ?? "Normal Working Day");
  const [remarks, setRemarks] = useState(existing?.remarks ?? "");
  const [saved, setSaved] = useState<Timesheet | null>(existing);
  const [previewOpen, setPreviewOpen] = useState(false);
  const readOnly = Boolean(existing) && !isEdit;

  const shownNo = existing?.timesheetNo || timesheetNo || runningNo.value;
  const deployment = deployments.find((row) => row.id === deploymentId) ?? null;
  const staff = deployment ? deploymentEmployees(deployment) : [];
  const employeeText = staff.length
    ? staff.map((employee) => employee.label).join(", ")
    : existing?.employeeLabel || "";

  useEffect(() => {
    if (readOnly) return;
    const next = calcHours(timeIn, timeOut, breakHours);
    if (next.normal) setNormalHours(next.normal);
    if (next.overtime) setOvertimeHours(next.overtime);
  }, [timeIn, timeOut, breakHours, readOnly]);

  function onDeployment(value: string) {
    const row = deployments.find((item) => item.id === value);
    if (!row) return;
    setDeploymentId(row.id);
    setEmployeeKey(deploymentEmployees(row)[0]?.id ?? "");
  }

  function partyEmail(partyId: string) {
    return parties.find((party) => String(party.id) === partyId)?.contactEmail || "";
  }

  async function submit() {
    const chosen = deployments.find((row) => row.id === deploymentId);
    const chosenStaff = chosen ? deploymentEmployees(chosen) : [];
    if (!chosen) {
      toast({ title: "Select deployment", variant: "destructive" });
      return;
    }
    const record: Timesheet = {
      id: saved?.id ?? existing?.id ?? `${Date.now()}`,
      companyId,
      side,
      timesheetNo: shownNo,
      deploymentId: chosen.id,
      deploymentNo: chosen.deploymentNo,
      employeeId: chosenStaff.map((employee) => employee.id).join(",") || employeeKey,
      employeeLabel: chosenStaff.map((employee) => employee.label).join(", "),
      partyId: chosen?.partyId ?? "",
      partyName: chosen?.partyName ?? "",
      partyEmail: partyEmail(chosen?.partyId ?? ""),
      workLocation: chosen?.workLocation ?? "",
      workDate,
      timeIn,
      timeOut,
      breakHours,
      normalHours,
      overtimeHours,
      dayType,
      remarks: remarks.trim(),
      submittedBy: user?.username || "Admin",
      status: isEdit && existing?.status ? existing.status : "submitted",
      sentTo: existing?.sentTo ?? "",
    };
    saveTimesheet(record);
    if (isEdit) {
      toast({ title: "Timesheet updated." });
      setLocation(listPath);
      return;
    }
    if (!existing && !saved) {
      await fetch("/api/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tsCounter: runningNo.counter }),
      });
      queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
    }
    setSaved(record);
    setPreviewOpen(true);
    toast({ title: "Timesheet submitted." });
  }

  const current = saved ?? existing;
  const approvalLabel = side === "customer" ? "Customer Approval" : "Vendor Approval";

  function remove() {
    if (!existing) return;
    removeTimesheet(existing.id);
    toast({ title: "Timesheet deleted." });
    setLocation(listPath);
  }

  return (
    <>
      <FormPageShell
        title={isEdit ? "Edit Timesheet" : existing ? "Timesheet" : "New Timesheet"}
        backHref={listPath}
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            {isEdit && existing ? (
              <Button type="button" variant="ghost" size="icon" className="text-destructive" aria-label="Delete timesheet" onClick={remove}>
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : <span />}
            <div className="flex items-center gap-3">
              <ModalCancelButton onClick={() => setLocation(listPath)} label={readOnly ? "Back" : "Cancel"} />
              {!readOnly && <ModalSaveButton type="button" onClick={submit} label={isEdit ? "Save" : "Submit Timesheet"} />}
              {readOnly && current && current.status !== "draft" && (
                <ModalSaveButton type="button" onClick={() => setPreviewOpen(true)} label={`${partyNoun} Approval`} />
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-8">
          <section className="space-y-4">
            <ModalSectionHeader title="Daily Timesheet" />
            <div className={formFieldGridClass}>
              <Readonly label="Timesheet No." value={shownNo} mono />
              <Field label="Deployment No.">
                <Select value={deploymentId || undefined} onValueChange={onDeployment} disabled={readOnly}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select deployment" />
                  </SelectTrigger>
                  <SelectContent>
                    {deployments.length === 0 ? (
                      <SelectItem value="__none" disabled>No deployments found</SelectItem>
                    ) : deployments.map((row) => (
                      <SelectItem key={row.id} value={row.id}>{row.deploymentNo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </section>

          <section className="space-y-4">
            <ModalSectionHeader title={`Employee & ${partyNoun}`} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Readonly label="Employee" value={employeeText} />
              <Readonly label={partyNoun} value={deployment?.partyName || current?.partyName || ""} />
              <Readonly label="Worksite" value={deployment?.workLocation || current?.workLocation || ""} />
              <Field label="Work Date">
                <SimpleDatePicker date={isoToDate(workDate)} setDate={(date) => setWorkDate(dateToIso(date))} disabled={readOnly} />
              </Field>
            </div>
          </section>

          <section className="space-y-4">
            <ModalSectionHeader title="Working Hours" />
            <div className={formFieldGridClass}>
              <Field label="Time In">
                <Input type="time" value={timeIn} onChange={(event) => setTimeIn(event.target.value)} disabled={readOnly} />
              </Field>
              <Field label="Time Out">
                <Input type="time" value={timeOut} onChange={(event) => setTimeOut(event.target.value)} disabled={readOnly} />
              </Field>
              <Field label="Break Hours">
                <Input inputMode="decimal" value={breakHours} onChange={(event) => setBreakHours(event.target.value)} readOnly={readOnly} />
              </Field>
              <Field label="Normal Hours">
                <Input inputMode="decimal" value={normalHours} onChange={(event) => setNormalHours(event.target.value)} readOnly={readOnly} />
              </Field>
              <Field label="Overtime Hours">
                <Input inputMode="decimal" value={overtimeHours} onChange={(event) => setOvertimeHours(event.target.value)} readOnly={readOnly} />
              </Field>
            </div>
            <Field label="Day Type">
              <RadioGroup value={dayType} onValueChange={setDayType} className="grid gap-2" disabled={readOnly}>
                {DAY_TYPES.map((item) => (
                  <label key={item} className="flex items-center gap-2 text-sm text-[#111827]">
                    <RadioGroupItem value={item} disabled={readOnly} />
                    {item}
                  </label>
                ))}
              </RadioGroup>
            </Field>
            <Field label="Remarks">
              <Textarea
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
                placeholder="Enter work details or remarks..."
                readOnly={readOnly}
                rows={3}
              />
            </Field>
          </section>

          <section className="space-y-4">
            <ModalSectionHeader title="Approval Details" />
            <div className={formFieldGridClass}>
              <Readonly label="Submitted By" value={current?.submittedBy || user?.username || "Admin"} />
              <Readonly
                label={approvalLabel}
                value={current?.status === "approved" ? "Approved" : current?.status === "rejected" ? "Rejected" : "Pending"}
              />
              <Readonly label="Status" value={current?.status === "approved" ? "Approved" : current?.status === "rejected" ? "Rejected" : current?.status === "submitted" ? "Pending" : "Draft"} />
            </div>
          </section>
        </div>
      </FormPageShell>

      {current && (
        <PdfPreviewModal
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          title="Timesheet"
          generatePdf={(opts) => generateTimesheetPdf(current, selectedCompany?.name || "BizOne", opts)}
          pdfFilename={`${current.timesheetNo}.pdf`}
          defaultEmailTo={current.partyEmail}
          defaultEmailSubject={`${partyNoun} Timesheet Approval`}
          defaultEmailBody={`Dear ${current.partyName || "Sir/Madam"},\n\nPlease find the timesheet approval.\n\nThank you.`}
          onEmailSent={(recipients) => {
            const sentTo = recipients.join(", ");
            updateTimesheet(current.id, { sentTo });
            setSaved({ ...current, sentTo });
            toast({ title: `Sent to ${partyNoun.toLowerCase()}.` });
          }}
        />
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className={labelClass}>{label}</Label>
      {children}
    </div>
  );
}

function Readonly({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Field label={label}>
      <div className={`flex min-h-10 items-center rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 text-sm text-[#111827] ${mono ? "font-mono" : ""}`}>
        <span className="min-w-0 break-words">{value}</span>
      </div>
    </Field>
  );
}
