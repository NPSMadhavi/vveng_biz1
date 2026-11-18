import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleDatePicker } from "@/components/ui/simple-date-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useGetSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FormPageShell } from "@/operations-8june/components/layout/FormPageShell";
import {
  ModalCancelButton,
  ModalSaveButton,
  ModalSectionHeader,
} from "@/operations-8june/components/forms/FormModalShell";
import { formFieldGridClass } from "@/lib/form-ui";
import { isManpowerParty } from "@/lib/party-usage";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  addSupplierPerson,
  deploymentEmployees,
  loadDeployments,
  loadSupplierPeople,
  removeDeployment,
  saveDeployment,
  todayIso,
  type DeploymentEmployee,
  type DeploymentSide,
  type EmployeeDeployment,
} from "./deployment-store";

type Party = { id: number; name: string; usageType?: string | null };
type Staff = { id: number; employeeId?: string | number | null; name?: string | null; designation?: string | null };

const SHIFTS = ["Day Shift", "Night Shift", "Rotating Shift"];
const labelClass = "text-sm font-medium text-[#111827]";

async function fetchJson<T>(url: string): Promise<T[]> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export function CustomerDeploymentForm() {
  return <EmployeeDeploymentForm side="customer" />;
}

export function SupplierDeploymentForm() {
  return <EmployeeDeploymentForm side="supplier" />;
}

export default function EmployeeDeploymentForm({ side }: { side: DeploymentSide }) {
  const [location, setLocation] = useLocation();
  const viewPattern = side === "customer"
    ? "/manpower/customers/employee-deployment/:id"
    : "/manpower/suppliers/employee-deployment/:id";
  const editPattern = side === "customer"
    ? "/manpower/customers/employee-deployment/:id/edit"
    : "/manpower/suppliers/employee-deployment/:id/edit";
  const [, viewParams] = useRoute(viewPattern);
  const [, editParams] = useRoute(editPattern);
  const params = editParams ?? viewParams;
  const isEdit = location.endsWith("/edit");
  const { selectedCompany } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const companyId = selectedCompany?.id ?? null;
  const existingId = params?.id && params.id !== "new" ? params.id : null;
  const existing = useMemo(
    () => (existingId ? loadDeployments().find((row) => row.id === existingId && row.side === side) ?? null : null),
    [existingId, side],
  );
  const readOnly = Boolean(existing) && !isEdit;

  const partyUrl = side === "customer" ? "/api/customers" : "/api/vendors";
  const { data: parties = [] } = useQuery({
    queryKey: ["manpower-parties", side],
    queryFn: () => fetchJson<Party>(partyUrl),
  });
  const { data: employees = [] } = useQuery({
    queryKey: ["manpower-employees"],
    queryFn: () => fetchJson<Staff>("/api/employees"),
  });

  const runningNo = useMemo(() => {
    const prefix = String((settings as { depPrefix?: string } | undefined)?.depPrefix ?? "DEP");
    const counter = (Number((settings as { depCounter?: number } | undefined)?.depCounter) || 0) + 1;
    const suffix = String((settings as { depSuffix?: string } | undefined)?.depSuffix ?? "");
    return { prefix, counter, suffix, value: `${prefix}${counter}${suffix}` };
  }, [settings]);
  const deploymentNo = existing?.deploymentNo ?? runningNo.value;
  const [deploymentDate, setDeploymentDate] = useState(() => existing?.deploymentDate ?? todayIso());
  const [partyId, setPartyId] = useState(existing?.partyId ?? "");
  const manpowerParties = useMemo(
    () => parties.filter((party) => isManpowerParty(party) || String(party.id) === partyId),
    [parties, partyId],
  );
  const [poNumber, setPoNumber] = useState(existing?.poNumber ?? "");
  const [workLocation, setWorkLocation] = useState(existing?.workLocation ?? "");
  const [picked, setPicked] = useState<DeploymentEmployee[]>(() => existing ? deploymentEmployees(existing) : []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesignation, setCreateDesignation] = useState("");
  const [supplierPeople, setSupplierPeople] = useState(() => loadSupplierPeople(companyId));
  useEffect(() => {
    setSupplierPeople(loadSupplierPeople(companyId));
  }, [companyId]);
  const [viewOpen, setViewOpen] = useState(false);
  useEffect(() => {
    if (picked.length === 0) setViewOpen(false);
  }, [picked.length]);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [designation, setDesignation] = useState(() => {
    const fromPeople = uniqueDesignations(existing ? deploymentEmployees(existing) : []);
    return fromPeople.length ? fromPeople.join(", ") : (existing?.designation ?? "");
  });
  const [startDate, setStartDate] = useState(existing?.startDate ?? "");
  const [endDate, setEndDate] = useState(existing?.endDate ?? "");
  const [workShift, setWorkShift] = useState(existing?.workShift ?? "");
  const [billingRate, setBillingRate] = useState(existing?.billingRate ?? "");
  const [payRate, setPayRate] = useState(existing?.payRate ?? "");

  const partyNoun = side === "customer" ? "Customer" : "Vendor";
  const listPath = side === "customer"
    ? "/manpower/customers/employee-deployment"
    : "/manpower/suppliers/employee-deployment";

  const selectedDesignations = useMemo(
    () => new Set(designation.split(",").map((item) => item.trim()).filter(Boolean)),
    [designation],
  );
  const designations = useMemo(() => {
    const values = new Set<string>();
    employees.forEach((employee) => {
      if (employee.designation) values.add(employee.designation);
    });
    supplierPeople.forEach((person) => {
      if (person.designation) values.add(person.designation);
    });
    picked.forEach((person) => {
      if (person.designation) values.add(person.designation);
    });
    ["Technician", "Supervisor", "Engineer", "Operator", "Helper"].forEach((item) => values.add(item));
    selectedDesignations.forEach((item) => values.add(item));
    return [...values];
  }, [employees, supplierPeople, picked, selectedDesignations]);

  const staffRows = useMemo(
    () => [...employees].sort((a, b) =>
      String(a.employeeId ?? "").localeCompare(String(b.employeeId ?? ""), undefined, { numeric: true }),
    ),
    [employees],
  );

  function openPicker() {
    setDraftIds(picked.map((employee) => employee.id));
    setPickerOpen(true);
  }

  function createSupplierPerson() {
    const name = createName.trim();
    if (!name) {
      toast({ title: "Enter a name", variant: "destructive" });
      return;
    }
    const person = addSupplierPerson(companyId, name, createDesignation);
    setSupplierPeople(loadSupplierPeople(companyId));
    setDraftIds((current) => current.includes(person.id) ? current : [...current, person.id]);
    setCreateName("");
    setCreateDesignation("");
    setCreateOpen(false);
  }

  function toggleEmployee(id: string) {
    setDraftIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  const isSupplier = side === "supplier";
  const supplierRows = useMemo(() => {
    const byId = new Map(supplierPeople.map((person) => [person.id, { name: person.name, designation: person.designation || "" }]));
    picked.forEach((person) => {
      if (!byId.has(person.id)) byId.set(person.id, { name: person.label, designation: person.designation || "" });
    });
    return [...byId.entries()].map(([id, person]) => ({ id, name: person.name, designation: person.designation }));
  }, [supplierPeople, picked]);

  function confirmEmployees() {
    const next = isSupplier
      ? supplierRows
        .filter((person) => draftIds.includes(person.id))
        .map((person) => ({ id: person.id, label: person.name, designation: person.designation }))
      : staffRows
        .filter((employee) => draftIds.includes(String(employee.id)))
        .map((employee) => ({
          id: String(employee.id),
          label: `${employee.name || "Employee"} – ${employee.employeeId || employee.id}`,
          designation: employee.designation || "",
        }));
    if (next.length === 0) {
      toast({
        title: isSupplier ? "Select manpower supplier" : "Select employee",
        description: isSupplier ? "Choose at least one manpower supplier." : "Choose at least one employee.",
        variant: "destructive",
      });
      return;
    }
    setPicked(next);
    setDesignation(uniqueDesignations(next).join(", "));
    setPickerOpen(false);
  }

  async function save() {
    const party = parties.find((item) => String(item.id) === partyId);
    if (!party) {
      toast({ title: `Select ${partyNoun.toLowerCase()}`, variant: "destructive" });
      return;
    }
    if (picked.length === 0) {
      toast({ title: isSupplier ? "Select manpower supplier" : "Select employee", variant: "destructive" });
      return;
    }
    const record: EmployeeDeployment = {
      id: existing?.id ?? `${Date.now()}`,
      companyId,
      side,
      deploymentNo,
      deploymentDate,
      partyId,
      partyName: party.name,
      poNumber: poNumber.trim(),
      workLocation: workLocation.trim(),
      employeeId: picked.map((employee) => employee.id).join(","),
      employeeLabel: picked.map((employee) => employee.label).join(", "),
      employees: picked,
      designation,
      startDate,
      endDate,
      workShift,
      billingRate: billingRate.trim(),
      payRate: payRate.trim(),
    };
    saveDeployment(record);
    if (!existing) {
      await fetch("/api/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depCounter: runningNo.counter }),
      });
      queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
    }
    toast({ title: existing ? "Deployment saved." : "Employee deployment created." });
    setLocation(listPath);
  }

  function remove() {
    if (!existing) return;
    removeDeployment(existing.id);
    toast({ title: "Deployment deleted." });
    setLocation(listPath);
  }

  return (
    <FormPageShell
      title={isEdit ? "Edit Employee Deployment" : existing ? "Employee Deployment" : "New Employee Deployment"}
      backHref={listPath}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          {isEdit && existing ? (
            <Button type="button" variant="ghost" size="icon" className="text-destructive" aria-label="Delete deployment" onClick={remove}>
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : <span />}
          <div className="flex items-center gap-3">
            <ModalCancelButton onClick={() => setLocation(listPath)} label={readOnly ? "Back" : "Cancel"} />
            {!readOnly && <ModalSaveButton type="button" onClick={save} label="Save" />}
          </div>
        </div>
      }
    >
      <div className="space-y-8">
        <section className="space-y-4">
          <ModalSectionHeader title="Basic Details" />
          <div className={formFieldGridClass}>
            <Field label="Deployment No.">
              <div className="flex h-10 items-center rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-3 font-mono text-sm text-[#111827]">
                {deploymentNo}
              </div>
            </Field>
            <Field label="Deployment Date">
              <SimpleDatePicker
                date={isoToDate(deploymentDate)}
                setDate={(date) => setDeploymentDate(dateToIso(date))}
                disabled={readOnly}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <ModalSectionHeader title={`${partyNoun} Details`} />
          <div className={formFieldGridClass}>
            <Field label={`${partyNoun} Name`} required>
              <Select value={partyId || undefined} onValueChange={setPartyId} disabled={readOnly}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={`Select ${partyNoun.toLowerCase()}`} />
                </SelectTrigger>
                <SelectContent>
                  {manpowerParties.length === 0 ? (
                    <SelectItem value="__none" disabled>No {partyNoun.toLowerCase()}s found</SelectItem>
                  ) : (
                    manpowerParties.map((party) => (
                      <SelectItem key={party.id} value={String(party.id)}>{party.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field label={`${partyNoun} PO Number`}>
              <Input value={poNumber} onChange={(event) => setPoNumber(event.target.value)} readOnly={readOnly} />
            </Field>
            <Field label="Work Location / Site">
              <Input value={workLocation} onChange={(event) => setWorkLocation(event.target.value)} readOnly={readOnly} />
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <ModalSectionHeader title="Employee Details" />
          <div className={formFieldGridClass}>
            <Field label={isSupplier ? "Select Manpower Supplier" : "Select Employee"} required>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={openPicker}
                  disabled={readOnly}
                  className="flex h-10 min-w-0 flex-1 items-center justify-between rounded-lg border border-[#E5E7EB] bg-white px-3 text-left text-sm disabled:cursor-default disabled:bg-[#F8FAFC]"
                >
                  <span className={picked.length ? "truncate text-[#111827]" : "truncate text-[#6B7280]"}>
                    {picked.length
                      ? `${picked.length} ${isSupplier ? "manpower supplier" : "employee"}${picked.length === 1 ? "" : "s"} selected`
                      : isSupplier ? "Select manpower supplier" : "Select employee"}
                  </span>
                  {!readOnly && <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-[#6B7280]" />}
                </button>
                <Button type="button" variant="outline" className="h-10 shrink-0" disabled={picked.length === 0} onClick={() => setViewOpen(true)}>
                  View
                </Button>
              </div>
            </Field>
            <Field label="Designation">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={readOnly}
                    className="flex h-10 w-full items-center justify-between rounded-lg border border-[#E5E7EB] bg-white px-3 text-left text-sm disabled:cursor-default disabled:bg-[#F8FAFC]"
                  >
                    <span className={designation ? "truncate text-[#111827]" : "truncate text-[#6B7280]"}>
                      {designation || "Select designation"}
                    </span>
                    {!readOnly && <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-[#6B7280]" />}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1">
                  <div className="max-h-64 overflow-y-auto">
                    {designations.map((item) => {
                      const checked = selectedDesignations.has(item);
                      return (
                        <button
                          key={item}
                          type="button"
                          className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            const next = checked
                              ? [...selectedDesignations].filter((value) => value !== item)
                              : [...selectedDesignations, item];
                            setDesignation(next.join(", "));
                          }}
                        >
                          <span>{item}</span>
                          {checked ? <Check className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <ModalSectionHeader title="Deployment Period" />
          <div className={formFieldGridClass}>
            <Field label="Start Date">
              <SimpleDatePicker
                date={isoToDate(startDate)}
                setDate={(date) => setStartDate(dateToIso(date))}
                disabled={readOnly}
              />
            </Field>
            <Field label="End Date">
              <SimpleDatePicker
                date={isoToDate(endDate)}
                setDate={(date) => setEndDate(dateToIso(date))}
                disabled={readOnly}
              />
            </Field>
            <Field label="Work Shift">
              <Select value={workShift || undefined} onValueChange={setWorkShift} disabled={readOnly}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select shift" />
                </SelectTrigger>
                <SelectContent>
                  {SHIFTS.map((shift) => (
                    <SelectItem key={shift} value={shift}>{shift}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <ModalSectionHeader title="Commercial Details" />
          <div className={formFieldGridClass}>
            <Field label={`${partyNoun} Billing Rate (SGD/hour)`}>
              <Input
                inputMode="decimal"
                value={billingRate}
                onChange={(event) => setBillingRate(event.target.value)}
                readOnly={readOnly}
              />
            </Field>
            <Field label="Employee Pay Rate (SGD/hour)">
              <Input
                inputMode="decimal"
                value={payRate}
                onChange={(event) => setPayRate(event.target.value)}
                readOnly={readOnly}
              />
            </Field>
          </div>
        </section>
      </div>
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="z-[80] flex max-h-[80vh] max-w-lg flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{isSupplier ? "Selected Manpower Suppliers" : "Selected Employees"}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
            <ul className="divide-y">
              {picked.map((employee) => (
                <li key={employee.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-[#111827]">{employee.label}</span>
                    {employee.designation ? (
                      <span className="block truncate text-xs text-[#6B7280]">{employee.designation}</span>
                    ) : null}
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="rounded p-1 text-[#6B7280] hover:bg-[#F3F4F6]"
                      aria-label={`Remove ${employee.label}`}
                      onClick={() => setPicked((current) => {
                        const next = current.filter((item) => item.id !== employee.id);
                        setDesignation(uniqueDesignations(next).join(", "));
                        return next;
                      })}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setViewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="z-[80] flex max-h-[80vh] max-w-lg flex-col gap-4">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3 pr-6">
              <DialogTitle>{isSupplier ? "Select Manpower Supplier" : "Select Employee"}</DialogTitle>
              {side === "supplier" && (
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Create
                </Button>
              )}
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
            {isSupplier ? (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="border-b text-left">
                    <th className="w-12 px-3 py-2" />
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Designation</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No manpower suppliers yet. Use Create and enter a name.</td>
                    </tr>
                  ) : supplierRows.map((person) => {
                    const checked = draftIds.includes(person.id);
                    return (
                      <tr
                        key={person.id}
                        className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                        onClick={() => toggleEmployee(person.id)}
                      >
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleEmployee(person.id)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Select ${person.name}`}
                          />
                        </td>
                        <td className="px-3 py-2">{person.name}</td>
                        <td className="px-3 py-2">{person.designation || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr className="border-b text-left">
                  <th className="w-12 px-3 py-2" />
                  <th className="px-3 py-2 font-medium">Employee ID</th>
                  <th className="px-3 py-2 font-medium">Employee Name</th>
                  <th className="px-3 py-2 font-medium">Designation</th>
                </tr>
              </thead>
              <tbody>
                {staffRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No employees found.</td>
                  </tr>
                ) : staffRows.map((employee) => {
                  const id = String(employee.id);
                  const checked = draftIds.includes(id);
                  return (
                    <tr
                      key={id}
                      className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                      onClick={() => toggleEmployee(id)}
                    >
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleEmployee(id)}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Select ${employee.name || "employee"}`}
                        />
                      </td>
                      <td className="px-3 py-2">{employee.employeeId || "—"}</td>
                      <td className="px-3 py-2">{employee.name || "—"}</td>
                      <td className="px-3 py-2">{employee.designation || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPickerOpen(false)}>Cancel</Button>
            <Button type="button" onClick={confirmEmployees} disabled={draftIds.length === 0}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {isSupplier && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="z-[100] max-w-md gap-4">
            <DialogHeader>
              <DialogTitle>Create Manpower Supplier</DialogTitle>
            </DialogHeader>
            <Field label="Name" required>
              <Input
                value={createName}
                autoFocus
                onChange={(event) => setCreateName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    createSupplierPerson();
                  }
                }}
              />
            </Field>
            <Field label="Designation">
              <Input
                value={createDesignation}
                onChange={(event) => setCreateDesignation(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    createSupplierPerson();
                  }
                }}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="button" onClick={createSupplierPerson}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </FormPageShell>
  );
}

function uniqueDesignations(people: { designation?: string }[]) {
  return [...new Set(people.map((person) => (person.designation || "").trim()).filter(Boolean))];
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className={labelClass}>
        {label}{required ? <span className="text-[#DC2626]"> *</span> : null}
      </Label>
      {children}
    </div>
  );
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
