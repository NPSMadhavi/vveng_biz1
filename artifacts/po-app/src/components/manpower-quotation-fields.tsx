import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { z } from "zod";
import { useFieldArray, useFormContext, useWatch, type Control } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SyncBridgeDatePicker } from "@/components/ui/sync-bridge-date-picker";

export const BILLING_TYPES = ["Hourly", "Daily", "Monthly"];
export const EXTRA_WORK_TYPES = ["Selection", "Rest Day", "Public Holiday"];
const CREATE_DESIGNATION = "__create__";
const CREATE_WORKER = "__create_worker__";

/** OT rate = base × 1.5 (2 d.p.). Empty/invalid base → "". */
export function otRateFromBase(raw: string): string {
  const n = Number(String(raw || "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Math.round(n * 1.5 * 100) / 100);
}

export const manpowerDetailsSchema = z.object({
  phone: z.string().optional(),
  project: z.string().optional(),
  workLocation: z.string().optional(),
  serviceStartDate: z.string().optional(),
  serviceEndDate: z.string().optional(),
  source: z.enum(["own", "supplier"]).optional(),
  designation: z.string().optional(),
  workers: z.string().optional(),
  hours: z.string().optional(),
  employeeIds: z.array(z.coerce.number()).optional(),
  employeeNames: z.string().optional(),
  workerNames: z.string().optional(),
  extraWorkType: z.string().optional(),
  billingType: z.string().optional(),
  customerRate: z.string().optional(),
  customerRateOt15: z.string().optional(),
  customerRateGst: z.string().optional(),
  customerBillingRates: z.array(z.object({
    category: z.string(),
    rate: z.string().optional(),
    gst: z.string().optional(),
  })).optional(),
  standardHours: z.string().optional(),
  weekdayOtRate: z.string().optional(),
  supplierRate: z.string().optional(),
  workingDates: z.string().optional(),
  otSupplierRate: z.string().optional(),
}).passthrough();

export const emptyManpowerDetails = {
  phone: "",
  project: "",
  workLocation: "",
  serviceStartDate: "",
  serviceEndDate: "",
  source: "own" as const,
  designation: "",
  workers: "",
  hours: "",
  employeeIds: [] as number[],
  employeeNames: "",
  workerNames: "",
  extraWorkType: "",
  billingType: "Hourly",
  customerRate: "",
  customerRateOt15: "",
  customerRateGst: "Applicable",
  customerBillingRates: [
    { category: "Normal Hour", rate: "", gst: "Applicable" },
    { category: "OT 1.5x", rate: "", gst: "Applicable" },
  ],
  standardHours: "8",
  weekdayOtRate: "",
  supplierRate: "",
  workingDates: "",
  otSupplierRate: "",
};

function fitAddressHeight(el: HTMLTextAreaElement) {
  el.style.height = "40px";
  el.style.height = `${Math.max(40, el.scrollHeight)}px`;
}

function GrowingAddress({ value, onChange, onBlur, name, disabled }: {
  value?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  name: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (ref.current) fitAddressHeight(ref.current);
  }, [value]);
  return (
    <Textarea
      ref={ref}
      name={name}
      rows={1}
      disabled={disabled}
      value={value || ""}
      onBlur={onBlur}
      onChange={(event) => {
        onChange(event.target.value);
        fitAddressHeight(event.target);
      }}
      className="h-10 min-h-10 resize-none overflow-hidden py-2 leading-5"
    />
  );
}

export function ManpowerServiceDateFields({ control }: { control: Control<any> }) {
  return (
    <>
      <FormField control={control} name="manpowerDetails.serviceStartDate" render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel>Service Start Date</FormLabel>
          <FormControl>
            <SyncBridgeDatePicker value={field.value || ""} onChange={field.onChange} placeholder="DD/MM/YYYY" />
          </FormControl>
        </FormItem>
      )} />
      <FormField control={control} name="manpowerDetails.serviceEndDate" render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel>Service End Date</FormLabel>
          <FormControl>
            <SyncBridgeDatePicker value={field.value || ""} onChange={field.onChange} placeholder="DD/MM/YYYY" />
          </FormControl>
        </FormItem>
      )} />
    </>
  );
}

export function ManpowerCustomerExtraFields({ control, addressName = "customerAddress" }: { control: Control<any>; addressName?: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <FormField control={control} name="manpowerDetails.phone" render={({ field }) => (
        <FormItem>
          <FormLabel>Contact Number</FormLabel>
          <FormControl><Input {...field} value={field.value || ""} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />
      <FormField control={control} name="manpowerDetails.workLocation" render={({ field }) => (
        <FormItem>
          <FormLabel>Work Location / Site</FormLabel>
          <FormControl><Input {...field} value={field.value || ""} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />
      <FormField control={control} name={addressName} render={({ field }) => (
        <FormItem>
          <FormLabel>Address</FormLabel>
          <FormControl>
            <GrowingAddress
              name={field.name}
              value={field.value}
              onBlur={field.onBlur}
              disabled={field.disabled}
              onChange={field.onChange}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )} />
    </div>
  );
}

export function ManpowerLineItemsTable({
  control,
  fields,
  remove,
  currency,
  formatAmount,
}: {
  control: Control<any>;
  fields: { id: string }[];
  remove: (index: number) => void;
  currency: string;
  formatAmount: (value: number) => string;
}) {
  const items = useWatch({ control, name: "items" }) || [];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b text-sm text-foreground">
          <tr>
            <th className="px-6 py-3 text-left font-semibold">Designation</th>
            <th className="px-6 py-3 text-right font-semibold w-28">Workers</th>
            <th className="px-6 py-3 text-right font-semibold w-28">Hours</th>
            <th className="px-6 py-3 text-left font-semibold w-36">Billing</th>
            <th className="px-6 py-3 text-right font-semibold w-40">Customer Rate</th>
            <th className="px-6 py-3 text-right font-semibold w-24">Disc %</th>
            <th className="px-6 py-3 text-right font-semibold w-32">Amount</th>
            <th className="px-6 py-3 text-center font-semibold w-16">FOC</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {fields.map((row, index) => {
            const isFoc = !!items[index]?.isFoc;
            const amount = quotationLineAmount(items[index] || {});
            return (
            <tr key={row.id} className="border-b last:border-0">
              <td className="px-4 py-3">
                <FormField control={control} name={`items.${index}.description`} render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input className="h-9 border-0 bg-transparent shadow-none focus-visible:ring-1" placeholder="Designation" {...field} value={field.value || ""} />
                    </FormControl>
                  </FormItem>
                )} />
              </td>
              <td className="px-4 py-3">
                <FormField control={control} name={`items.${index}.qty`} render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input inputMode="numeric" className="h-9 border-0 bg-transparent text-right shadow-none focus-visible:ring-1" {...field} value={field.value ?? ""} />
                    </FormControl>
                  </FormItem>
                )} />
              </td>
              <td className="px-4 py-3">
                <FormField control={control} name={`items.${index}.hours`} render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input inputMode="decimal" className="h-9 border-0 bg-transparent text-right shadow-none focus-visible:ring-1" placeholder="0" {...field} value={field.value ?? ""} />
                    </FormControl>
                  </FormItem>
                )} />
              </td>
              <td className="px-4 py-3">
                <FormField control={control} name={`items.${index}.uom`} render={({ field }) => (
                  <FormItem>
                    <Select value={field.value || "Hourly"} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="h-9 border-0 bg-transparent shadow-none"><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BILLING_TYPES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </td>
              <td className="px-4 py-3">
                <FormField control={control} name={`items.${index}.unitPrice`} render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-xs text-muted-foreground">{currency}</span>
                        <Input inputMode="decimal" className="h-9 w-24 border-0 bg-transparent text-right shadow-none focus-visible:ring-1" placeholder="0" {...field} value={field.value ?? ""} />
                      </div>
                    </FormControl>
                  </FormItem>
                )} />
              </td>
              <td className="px-4 py-3">
                <FormField control={control} name={`items.${index}.discount`} render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        inputMode="decimal"
                        className="h-9 border-0 bg-transparent text-right shadow-none focus-visible:ring-1"
                        placeholder="0"
                        value={field.value || ""}
                        onChange={(event) => field.onChange(parseFloat(event.target.value) || 0)}
                        onBlur={field.onBlur}
                        name={field.name}
                      />
                    </FormControl>
                  </FormItem>
                )} />
              </td>
              <td className={`px-6 py-3 text-right font-medium ${isFoc ? "text-amber-600" : ""}`}>{formatAmount(amount)}</td>
              <td className="px-4 py-3 text-center">
                <FormField control={control} name={`items.${index}.isFoc`} render={({ field }) => (
                  <FormItem className="flex items-center justify-center space-y-0">
                    <FormControl>
                      <Checkbox checked={!!field.value} onCheckedChange={field.onChange} title="Free of Charge — excluded from subtotal" />
                    </FormControl>
                  </FormItem>
                )} />
              </td>
              <td className="px-2 py-3">
                {fields.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => remove(index)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function quotationLineAmount(item: {
  qty?: number | string;
  unitPrice?: number | string;
  discount?: number | string;
  hours?: number | string;
  uom?: string;
}) {
  const hours = Number(item?.hours) || 0;
  const uom = String(item?.uom || "").toLowerCase();
  const hourly = uom.startsWith("hour") || uom === "hr" || uom === "hrs";
  // Hourly: Amount = hours × rate (workers are headcount only, not multiplied).
  // Daily/Monthly: Amount = workers × rate.
  const disc = Number(item?.discount) || 0;
  const qty = Number(item?.qty) || 0;
  const price = Number(item?.unitPrice) || 0;
  const base = hourly ? (hours > 0 ? hours : 0) : qty;
  return Math.round(base * price * (1 - disc / 100) * 100) / 100;
}

export function blankManpowerLine(details: {
  designation: string;
  workers?: string;
  hours?: string;
  billingType?: string;
  customerRate?: string;
  supplierRate?: string;
}) {
  const customerRate = Number(details.customerRate);
  const supplierRate = Number(details.supplierRate);
  const unitPrice = customerRate > 0 ? customerRate : supplierRate > 0 ? supplierRate : 0;
  return {
    type: "item" as const,
    sectionLabel: "",
    sectionAlign: "left" as const,
    partNumber: "",
    description: details.designation,
    qty: Number(details.workers) > 0 ? Number(details.workers) : 1,
    hours: details.hours || "",
    uom: details.billingType || "Hourly",
    unitPrice,
    discount: 0,
    isFoc: false,
    itemImage: "",
  };
}

export function ManpowerRequirementsCard({
  control,
  onAddLine,
  supplierOnly = false,
  hideSource = false,
}: {
  control: Control<any>;
  onAddLine?: (line: ReturnType<typeof blankManpowerLine>) => void;
  /** Vendor quotations: only Supplier Manpower (no Own Employees). */
  supplierOnly?: boolean;
  /** Sales orders: hide Own/Supplier radio; always Own Employees. */
  hideSource?: boolean;
}) {
  const { getValues, setValue } = useFormContext();
  const watchedSource = useWatch({ control, name: "manpowerDetails.source" });
  const source = supplierOnly ? "supplier" : hideSource ? "own" : (watchedSource || "own");
  const showSupplierFields = source === "supplier";
  const showEmployeePicker = !supplierOnly && source === "own";

  useEffect(() => {
    if (supplierOnly) {
      if (watchedSource !== "supplier") {
        setValue("manpowerDetails.source", "supplier", { shouldDirty: false });
      }
      return;
    }
    if (hideSource && watchedSource !== "own") {
      setValue("manpowerDetails.source", "own", { shouldDirty: false });
    }
  }, [supplierOnly, hideSource, watchedSource, setValue]);

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const draftNameRef = useRef("");
  const [created, setCreated] = useState<string[]>([]);
  const [addError, setAddError] = useState("");
  const [creatingWorker, setCreatingWorker] = useState(false);
  const [draftWorkerName, setDraftWorkerName] = useState("");
  const draftWorkerNameRef = useRef("");
  const [createdWorkers, setCreatedWorkers] = useState<string[]>([]);
  const [workerError, setWorkerError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [workersDialogOpen, setWorkersDialogOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<number[]>([]);

  const selectedIds = (useWatch({ control, name: "manpowerDetails.employeeIds" }) || []) as number[];
  const watchedDesignation = String(useWatch({ control, name: "manpowerDetails.designation" }) || "").trim();
  const watchedWorkerNames = String(useWatch({ control, name: "manpowerDetails.workerNames" }) || "");
  const lineItems = useWatch({ control, name: "items" }) || [];
  const designationOptions = useMemo(() => {
    const fromLines = (lineItems as Array<{ description?: string }>)
      .map((item) => String(item?.description || "").trim())
      .filter(Boolean);
    return Array.from(new Set([...created, ...fromLines, ...(watchedDesignation ? [watchedDesignation] : [])]));
  }, [created, lineItems, watchedDesignation]);

  const workerList = useMemo(
    () => watchedWorkerNames.split(",").map((v) => v.trim()).filter(Boolean),
    [watchedWorkerNames],
  );
  const workerOptions = useMemo(
    () => Array.from(new Set([...createdWorkers, ...workerList])),
    [createdWorkers, workerList],
  );

  const { data: employees = [], isLoading: employeesLoading, isError: employeesError } = useQuery({
    queryKey: ["quotation-manpower-employees"],
    queryFn: fetchQuotationEmployees,
    enabled: showEmployeePicker || pickerOpen,
  });

  const employeeRows = useMemo(
    () =>
      [...employees].sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }),
      ),
    [employees],
  );

  const selectedSummary = useMemo(() => {
    const names = employeeRows
      .filter((e) => selectedIds.includes(Number(e.id)))
      .map((e) => e.name || String(e.employeeId || e.id));
    if (names.length) return names.join(", ");
    if (selectedIds.length) return selectedIds.length + " employee" + (selectedIds.length === 1 ? "" : "s") + " selected";
    return "";
  }, [employeeRows, selectedIds]);

  const applyEmployeeSelection = (ids: number[]) => {
    setValue("manpowerDetails.employeeIds", ids, { shouldDirty: true });
    const picked = employeeRows.filter((e) => ids.includes(Number(e.id)));
    const names = picked.map((e) => e.name || String(e.employeeId || e.id)).filter(Boolean);
    const designations = Array.from(
      new Set(picked.map((e) => String(e.designation || "").trim()).filter(Boolean)),
    );
    setValue("manpowerDetails.employeeNames", names.join(", "), { shouldDirty: true });
    setValue("manpowerDetails.designation", designations.join(", "), { shouldDirty: true });
    if (ids.length > 0) {
      setValue("manpowerDetails.workers", String(ids.length), { shouldDirty: true });
    }
    setCreating(false);
    setDraftName("");
    draftNameRef.current = "";
  };

  const openPicker = () => {
    setDraftIds(selectedIds.map(Number).filter((n) => Number.isFinite(n)));
    setPickerOpen(true);
  };

  const toggleDraft = (id: number) => {
    setDraftIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const confirmPicker = () => {
    applyEmployeeSelection(draftIds);
    setPickerOpen(false);
  };

  const addingRef = useRef(false);
  const addDesignationToLines = (nameOverride?: string) => {
    if (addingRef.current) return;
    const details = getValues("manpowerDetails") || {};
    const name = String(nameOverride || details.designation || draftNameRef.current || draftName || "").trim();
    if (!name || name === CREATE_DESIGNATION) {
      setAddError("Enter a designation, then press Enter.");
      return;
    }
    addingRef.current = true;
    setAddError("");
    setCreated((current) => (current.includes(name) ? current : [...current, name]));
    const line = blankManpowerLine({ ...details, designation: name });
    draftNameRef.current = "";
    setDraftName("");
    setCreating(false);
    setValue("manpowerDetails.designation", "", { shouldDirty: true });
    setValue("manpowerDetails.workers", "", { shouldDirty: true });
    setValue("manpowerDetails.hours", "", { shouldDirty: true });
    if (onAddLine) {
      onAddLine(line);
    } else {
      const items = (getValues("items") || []) as Array<Record<string, unknown>>;
      const onlyBlank = items.length === 1
        && !String(items[0]?.description || "").trim()
        && !String(items[0]?.partNumber || "").trim();
      if (onlyBlank) {
        setValue("items.0", { ...items[0], ...line }, { shouldDirty: true, shouldValidate: true });
      } else {
        setValue("items", [...items, line], { shouldDirty: true, shouldValidate: true });
      }
    }
    queueMicrotask(() => { addingRef.current = false; });
  };

  const addOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const input = event.currentTarget;
    if (input.placeholder === "Type a new designation") {
      draftNameRef.current = input.value;
      addDesignationToLines(input.value);
      return;
    }
    addDesignationToLines();
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Manpower Requirements</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hideSource && (
        <FormField control={control} name="manpowerDetails.source" render={({ field }) => (
          <FormItem className={supplierOnly ? "w-full max-w-[240px]" : undefined}>
            <FormLabel>Manpower Source</FormLabel>
            <FormControl>
              {supplierOnly ? (
                <div className="flex h-10 w-full items-center rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-3 text-sm font-medium text-[#111827]">
                  Supplier Manpower
                </div>
              ) : (
                <RadioGroup value={field.value || "own"} onValueChange={field.onChange} className="flex flex-wrap gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="own" />
                    Own Employees
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="supplier" />
                    Supplier Manpower
                  </label>
                </RadioGroup>
              )}
            </FormControl>
          </FormItem>
        )} />
        )}

        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-4">
          {showEmployeePicker ? (
            <FormItem>
              <FormLabel>Select Employee</FormLabel>
              <button
                type="button"
                onClick={openPicker}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-left text-sm"
              >
                <span className={selectedSummary ? "truncate text-foreground" : "truncate text-muted-foreground"}>
                  {selectedSummary || "Select employees"}
                </span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </FormItem>
          ) : (
            <FormField control={control} name="manpowerDetails.workerNames" render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>Workers Name</FormLabel>
                {creatingWorker ? (
                  <FormControl>
                    <Input
                      autoFocus
                      placeholder="Type worker name"
                      value={draftWorkerName}
                      onChange={(event) => {
                        draftWorkerNameRef.current = event.target.value;
                        setDraftWorkerName(event.target.value);
                        setWorkerError("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        const name = String(draftWorkerNameRef.current || draftWorkerName || "").trim();
                        if (!name || name === CREATE_WORKER) {
                          setWorkerError("Enter a worker name, then press Enter.");
                          return;
                        }
                        setCreatedWorkers((current) => (current.includes(name) ? current : [...current, name]));
                        const existing = String(field.value || "")
                          .split(",")
                          .map((v) => v.trim())
                          .filter(Boolean);
                        const next = existing.includes(name) ? existing : [...existing, name];
                        field.onChange(next.join(", "));
                        setValue("manpowerDetails.workers", String(next.length), { shouldDirty: true });
                        draftWorkerNameRef.current = "";
                        setDraftWorkerName("");
                        setCreatingWorker(false);
                        setWorkerError("");
                      }}
                    />
                  </FormControl>
                ) : (
                  <Select
                    value={undefined}
                    onValueChange={(value) => {
                      setWorkerError("");
                      if (value === CREATE_WORKER) {
                        setCreatingWorker(true);
                        draftWorkerNameRef.current = "";
                        setDraftWorkerName("");
                        return;
                      }
                      const existing = String(field.value || "")
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean);
                      const next = existing.includes(value) ? existing : [...existing, value];
                      field.onChange(next.join(", "));
                      setValue("manpowerDetails.workers", String(next.length), { shouldDirty: true });
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={field.value ? String(field.value) : "Create worker name"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={CREATE_WORKER}>Create</SelectItem>
                      {workerOptions.map((item) => (
                        <SelectItem key={item} value={item}>{item}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {workerList.length > 0 && (
                  <div className="pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs text-blue-700 border-blue-200 hover:bg-blue-50"
                      onClick={() => setWorkersDialogOpen(true)}
                    >
                      View Workers ({workerList.length})
                    </Button>
                  </div>
                )}
                {workerError ? <p className="text-sm font-medium text-destructive">{workerError}</p> : null}
              </FormItem>
            )} />
          )}

          <FormField control={control} name="manpowerDetails.designation" render={({ field }) => (
            <FormItem className="min-w-0">
              <FormLabel>Designation</FormLabel>
              {showEmployeePicker ? (
                <FormControl>
                  <Input {...field} value={field.value || ""} placeholder="Auto from employees" onKeyDown={addOnEnter} />
                </FormControl>
              ) : creating ? (
                <FormControl>
                  <Input
                    autoFocus
                    placeholder="Type a new designation"
                    value={draftName}
                    onChange={(event) => {
                      draftNameRef.current = event.target.value;
                      setDraftName(event.target.value);
                      field.onChange(event.target.value);
                      setAddError("");
                    }}
                    onKeyDown={addOnEnter}
                  />
                </FormControl>
              ) : (
                <Select
                  value={field.value || undefined}
                  onValueChange={(value) => {
                    setAddError("");
                    if (value === CREATE_DESIGNATION) {
                      setCreating(true);
                      draftNameRef.current = "";
                      setDraftName("");
                      field.onChange("");
                      return;
                    }
                    field.onChange(value);
                  }}
                >
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Create designation" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={CREATE_DESIGNATION}>Create</SelectItem>
                    {designationOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {addError ? <p className="text-sm font-medium text-destructive">{addError}</p> : null}
            </FormItem>
          )} />

          <FormField control={control} name="manpowerDetails.workers" render={({ field }) => (
            <FormItem>
              <FormLabel>Number of Workers</FormLabel>
              <FormControl><Input inputMode="numeric" {...field} value={field.value || ""} onKeyDown={addOnEnter} /></FormControl>
            </FormItem>
          )} />

          <FormField control={control} name="manpowerDetails.extraWorkType" render={({ field }) => (
            <FormItem>
              <FormLabel>Extra Work Type</FormLabel>
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  {EXTRA_WORK_TYPES.map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <FormField control={control} name="manpowerDetails.billingType" render={({ field }) => (
            <FormItem>
              <FormLabel>Billing Type</FormLabel>
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger><SelectValue placeholder="Select billing type" /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  {BILLING_TYPES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormItem>
          )} />
          <FormField control={control} name="manpowerDetails.customerRate" render={({ field }) => (
            <FormItem>
              <FormLabel>Customer Billing Rate</FormLabel>
              <FormControl>
                <Input
                  inputMode="decimal"
                  {...field}
                  value={field.value || ""}
                  onKeyDown={addOnEnter}
                  onChange={(e) => {
                    const v = e.target.value;
                    field.onChange(v);
                    const ot = otRateFromBase(v);
                    setValue("manpowerDetails.weekdayOtRate", ot, { shouldDirty: true });
                    setValue("manpowerDetails.customerRateOt15", ot, { shouldDirty: true });
                  }}
                />
              </FormControl>
            </FormItem>
          )} />
          <FormField control={control} name="manpowerDetails.standardHours" render={({ field }) => (
            <FormItem>
              <FormLabel>Standard Hours / Day</FormLabel>
              <FormControl><Input inputMode="decimal" {...field} value={field.value || ""} onKeyDown={addOnEnter} /></FormControl>
            </FormItem>
          )} />
          <FormField control={control} name="manpowerDetails.weekdayOtRate" render={({ field }) => (
            <FormItem className="min-w-0">
              <FormLabel>Customer OT Rate</FormLabel>
              <FormControl><Input inputMode="decimal" {...field} value={field.value || ""} onKeyDown={addOnEnter} /></FormControl>
            </FormItem>
          )} />
        </div>

        {showSupplierFields && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <FormField control={control} name="manpowerDetails.supplierRate" render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>Supplier Rate</FormLabel>
                <FormControl>
                  <Input
                    inputMode="decimal"
                    {...field}
                    value={field.value || ""}
                    onKeyDown={addOnEnter}
                    onChange={(e) => {
                      const v = e.target.value;
                      field.onChange(v);
                      setValue("manpowerDetails.otSupplierRate", otRateFromBase(v), { shouldDirty: true });
                    }}
                  />
                </FormControl>
              </FormItem>
            )} />
            <FormField control={control} name="manpowerDetails.otSupplierRate" render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>Supplier OT Rate</FormLabel>
                <FormControl><Input inputMode="decimal" {...field} value={field.value || ""} onKeyDown={addOnEnter} /></FormControl>
              </FormItem>
            )} />
          </div>
        )}

        <Dialog open={workersDialogOpen} onOpenChange={setWorkersDialogOpen}>
          <DialogContent className="z-[80] max-w-md">
            <DialogHeader>
              <DialogTitle>Workers ({workerList.length})</DialogTitle>
            </DialogHeader>
            {workerList.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground text-center">No workers added yet.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
                {workerList.map((w, idx) => (
                  <div key={w} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="font-medium text-foreground">
                      <span className="text-xs text-muted-foreground mr-2">{idx + 1}.</span>
                      {w}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${w}`}
                      onClick={() => {
                        const next = workerList.filter((item) => item !== w);
                        setValue("manpowerDetails.workerNames", next.join(", "), { shouldDirty: true });
                        setValue("manpowerDetails.workers", next.length ? String(next.length) : "", { shouldDirty: true });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button type="button" onClick={() => setWorkersDialogOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogContent className="z-[80] flex max-h-[80vh] max-w-lg flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Select Employees</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="border-b text-left">
                    <th className="w-12 px-3 py-2" />
                    <th className="px-3 py-2 font-medium">Employee Name</th>
                    <th className="px-3 py-2 font-medium">Designation</th>
                  </tr>
                </thead>
                <tbody>
                  {employeesLoading ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">Loading employees…</td>
                    </tr>
                  ) : employeesError ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-destructive">Could not load employees.</td>
                    </tr>
                  ) : employeeRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No employees found.</td>
                    </tr>
                  ) : (
                    employeeRows.map((employee) => {
                      const id = Number(employee.id);
                      const checked = draftIds.includes(id);
                      return (
                        <tr
                          key={id}
                          className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                          onClick={() => toggleDraft(id)}
                        >
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleDraft(id)}
                              onClick={(event) => event.stopPropagation()}
                              aria-label={"Select " + (employee.name || "employee")}
                            />
                          </td>
                          <td className="px-3 py-2">{employee.name || "—"}</td>
                          <td className="px-3 py-2">{employee.designation || "—"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPickerOpen(false)}>Cancel</Button>
              <Button type="button" onClick={confirmPicker} disabled={draftIds.length === 0}>
                Select{draftIds.length ? " (" + draftIds.length + ")" : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

type QuotationEmployeeOption = {
  id: number;
  name?: string | null;
  employeeId?: string | null;
  designation?: string | null;
  perHourCharge?: string | number | null;
};

async function fetchQuotationEmployees(): Promise<QuotationEmployeeOption[]> {
  const res = await fetch("/api/employees", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load employees");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export function ManpowerCustomerBillingRatesViewCard({
  manpowerDetails,
  currency = "SGD",
  title = "Customer Billing Rates",
  items,
}: {
  manpowerDetails: any;
  currency?: string;
  title?: string;
  items?: any[];
}) {
  const md = manpowerDetails && typeof manpowerDetails === "object" ? manpowerDetails : {};
  const isSupplier = md.source === "supplier" || /supplier/i.test(title);
  const normalFallback = isSupplier ? (md.supplierRate || md.customerRate) : md.customerRate;
  const otFallback = isSupplier ? (md.otSupplierRate || md.weekdayOtRate) : (md.customerRateOt15 || md.weekdayOtRate);
  
  let rawRates: Array<{ category?: string; rate?: string | number; gst?: string }> =
    Array.isArray(md.customerBillingRates) && md.customerBillingRates.length > 0
      ? md.customerBillingRates
      : [
          ...(normalFallback
            ? [{ category: "Normal Hour", rate: normalFallback, gst: md.customerRateGst || md.gst || "Applicable" }]
            : []),
          ...(otFallback
            ? [{ category: "OT 1.5x", rate: otFallback, gst: md.customerRateGst || md.gst || "Applicable" }]
            : []),
        ];

  if (rawRates.length === 0 && Array.isArray(items) && items.length > 0) {
    const regularItems = items.filter((it: any) => it.type !== "section");
    const firstItem = regularItems.find((it: any) => Number(it.unitPrice) > 0) || regularItems[0];
    if (firstItem) {
      const up = Number(firstItem.unitPrice) || 0;
      const otVal = Number((firstItem as any).otUnitPrice) || Number((firstItem as any).otRate) || (up > 0 ? Math.round(up * 1.5 * 100) / 100 : 0);
      const gst = (firstItem as any).gst || md.customerRateGst || "Applicable";
      if (up > 0) {
        rawRates.push({ category: "Normal Hour", rate: up, gst });
      }
      if (otVal > 0) {
        rawRates.push({ category: "OT 1.5x", rate: otVal, gst });
      }
    }
  }

  if (rawRates.length === 0) {
    rawRates.push({ category: "Normal Hour", rate: "", gst: "Applicable" });
    rawRates.push({ category: "OT 1.5x", rate: "", gst: "Applicable" });
  }

  const rows = rawRates;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-y text-xs text-muted-foreground uppercase">
            <tr>
              <th className="px-6 py-2.5 text-left w-10">#</th>
              <th className="px-6 py-2.5 text-left">Category</th>
              <th className="px-6 py-2.5 text-right">Rate ({currency})</th>
              <th className="px-6 py-2.5 text-center">GST</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row, idx) => {
              const rateNum = Number(row.rate);
              const rateStr = Number.isFinite(rateNum) && String(row.rate ?? "").trim() !== ""
                ? `${currency} ${rateNum.toFixed(2)}`
                : (row.rate ? String(row.rate) : "—");
              return (
                <tr key={idx} className="hover:bg-muted/20">
                  <td className="px-6 py-2.5 text-muted-foreground">{idx + 1}</td>
                  <td className="px-6 py-2.5 font-medium">{row.category || "—"}</td>
                  <td className="px-6 py-2.5 text-right font-mono tabular-nums">{rateStr}</td>
                  <td className="px-6 py-2.5 text-center text-muted-foreground">{row.gst || "Applicable"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function ManpowerCustomerBillingRatesCard({ control, title = "Customer Billing Rates" }: { control: Control<any>; title?: string }) {
  const { setValue, getValues } = useFormContext();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "manpowerDetails.customerBillingRates",
  });

  const watchedSource = useWatch({ control, name: "manpowerDetails.source" }) || "";
  const isSupplier = watchedSource === "supplier" || /supplier/i.test(title);
  const customerRate = useWatch({ control, name: "manpowerDetails.customerRate" }) || "";
  const customerRateOt15 = useWatch({ control, name: "manpowerDetails.customerRateOt15" }) || "";
  const weekdayOtRate = useWatch({ control, name: "manpowerDetails.weekdayOtRate" }) || "";
  const supplierRate = useWatch({ control, name: "manpowerDetails.supplierRate" }) || "";
  const otSupplierRate = useWatch({ control, name: "manpowerDetails.otSupplierRate" }) || "";
  const customerRateGst = useWatch({ control, name: "manpowerDetails.customerRateGst" }) || "Applicable";
  const syncingFromLegacy = useRef(false);

  const activeNormalRate = isSupplier ? supplierRate : customerRate;
  const activeOtRate = isSupplier ? otSupplierRate : (customerRateOt15 || weekdayOtRate);

  useEffect(() => {
    const normal = String(activeNormalRate || "");
    const ot15 = String(activeOtRate || "");
    const gst = String(customerRateGst || "Applicable");
    const current = getValues("manpowerDetails.customerBillingRates");
    const rows = Array.isArray(current) ? [...current] : [];
    while (rows.length < 2) {
      rows.push({
        category: rows.length === 0 ? "Normal Hour" : "OT 1.5x",
        rate: "",
        gst: "Applicable",
      });
    }
    const next0 = {
      ...rows[0],
      category: rows[0]?.category || "Normal Hour",
      rate: normal || String(rows[0]?.rate || ""),
      gst: rows[0]?.gst || gst,
    };
    const next1 = {
      ...rows[1],
      category: rows[1]?.category || "OT 1.5x",
      rate: ot15 || String(rows[1]?.rate || ""),
      gst: rows[1]?.gst || "Applicable",
    };
    if (String(rows[0]?.rate || "") === next0.rate && String(rows[1]?.rate || "") === next1.rate && rows.length >= 2) {
      return;
    }
    syncingFromLegacy.current = true;
    rows[0] = next0;
    rows[1] = next1;
    setValue("manpowerDetails.customerBillingRates", rows, { shouldDirty: false });
    queueMicrotask(() => { syncingFromLegacy.current = false; });
  }, [activeNormalRate, activeOtRate, customerRateGst, getValues, setValue]);

  const syncLegacyRates = (index: number, rate: string) => {
    if (syncingFromLegacy.current) return;
    if (index === 0) {
      const ot = otRateFromBase(rate);
      if (isSupplier) {
        setValue("manpowerDetails.supplierRate", rate, { shouldDirty: true });
        setValue("manpowerDetails.otSupplierRate", ot, { shouldDirty: true });
      } else {
        setValue("manpowerDetails.customerRate", rate, { shouldDirty: true });
        setValue("manpowerDetails.customerRateOt15", ot, { shouldDirty: true });
        setValue("manpowerDetails.weekdayOtRate", ot, { shouldDirty: true });
      }
      const rows = getValues("manpowerDetails.customerBillingRates");
      if (Array.isArray(rows) && rows[1]) {
        syncingFromLegacy.current = true;
        const next = [...rows];
        next[1] = { ...next[1], rate: ot };
        setValue("manpowerDetails.customerBillingRates", next, { shouldDirty: true });
        queueMicrotask(() => { syncingFromLegacy.current = false; });
      }
    }
    if (index === 1) {
      if (isSupplier) {
        setValue("manpowerDetails.otSupplierRate", rate, { shouldDirty: true });
      } else {
        setValue("manpowerDetails.customerRateOt15", rate, { shouldDirty: true });
        setValue("manpowerDetails.weekdayOtRate", rate, { shouldDirty: true });
      }
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg">{title}</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => append({ category: "", rate: "", gst: "Applicable" })}
          >
            + Add Line
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-hidden rounded-b-lg border-t border-[#E5E7EB]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#DBEAFE] text-left">
                <th className="px-4 py-2.5 font-semibold text-[#1E3A5F]">Category</th>
                <th className="px-4 py-2.5 font-semibold text-[#1E3A5F]">Rate (SGD / Hour)</th>
                <th className="px-4 py-2.5 font-semibold text-[#1E3A5F]">GST</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {fields.map((row, index) => (
                <tr key={row.id} className="border-b border-[#E5E7EB] bg-white last:border-0">
                  <td className="px-4 py-2">
                    <FormField control={control} name={`manpowerDetails.customerBillingRates.${index}.category`} render={({ field }) => (
                      <FormItem className="space-y-0">
                        <FormControl>
                          <Input className="h-9" placeholder="Category" {...field} value={field.value || ""} />
                        </FormControl>
                      </FormItem>
                    )} />
                  </td>
                  <td className="px-4 py-2">
                    <FormField control={control} name={`manpowerDetails.customerBillingRates.${index}.rate`} render={({ field }) => (
                      <FormItem className="space-y-0">
                        <FormControl>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">$</span>
                            <Input
                              inputMode="decimal"
                              className="h-9 max-w-[160px]"
                              placeholder="0.00"
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              value={field.value || ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v !== "" && !/^\d*\.?\d*$/.test(v)) return;
                                field.onChange(v);
                                syncLegacyRates(index, v);
                              }}
                            />
                          </div>
                        </FormControl>
                      </FormItem>
                    )} />
                  </td>
                  <td className="px-4 py-2">
                    <FormField control={control} name={`manpowerDetails.customerBillingRates.${index}.gst`} render={({ field }) => (
                      <FormItem className="space-y-0">
                        <Select value={field.value || "Applicable"} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="h-9 w-[140px]">
                              <SelectValue placeholder="GST" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Applicable">Applicable</SelectItem>
                            <SelectItem value="Not Applicable">Not Applicable</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </td>
                  <td className="px-2 py-2">
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}


export const salesManpowerSchema = z.object({
  customerPoNumber: z.string().optional(),
  customerPoDate: z.string().optional(),
  workLocation: z.string().optional(),
  project: z.string().optional(),
  poDate: z.string().optional(),
  poStartDate: z.string().optional(),
  poEndDate: z.string().optional(),
  source: z.enum(["own", "supplier"]).optional(),
  designation: z.string().optional(),
  workers: z.string().optional(),
  hours: z.string().optional(),
  employeeIds: z.array(z.coerce.number()).optional(),
  employeeNames: z.string().optional(),
  workerNames: z.string().optional(),
  extraWorkType: z.string().optional(),
  billingType: z.string().optional(),
  customerRate: z.string().optional(),
  customerRateOt15: z.string().optional(),
  customerRateGst: z.string().optional(),
  customerBillingRates: z.array(z.object({
    category: z.string(),
    rate: z.string().optional(),
    gst: z.string().optional(),
  })).optional(),
  standardHours: z.string().optional(),
  weekdayOtRate: z.string().optional(),
  supplierRate: z.string().optional(),
  workingDates: z.string().optional(),
  otSupplierRate: z.string().optional(),
}).passthrough();

export const emptySalesManpower = {
  customerPoNumber: "",
  customerPoDate: "",
  workLocation: "",
  project: "",
  poDate: "",
  poStartDate: "",
  poEndDate: "",
  source: "own",
  designation: "",
  workers: "",
  hours: "",
  employeeIds: [],
  employeeNames: "",
  workerNames: "",
  extraWorkType: "",
  billingType: "Hourly",
  customerRate: "",
  customerRateOt15: "",
  customerRateGst: "Applicable",
  customerBillingRates: [
    { category: "Normal Hour", rate: "", gst: "Applicable" },
    { category: "OT 1.5x", rate: "", gst: "Applicable" },
  ],
  standardHours: "8",
  weekdayOtRate: "",
  supplierRate: "",
  workingDates: "",
  otSupplierRate: "",
};

export const invoiceManpowerSchema = z.object({
  workLocation: z.string().optional(),
});

export const emptyInvoiceManpower = {
  workLocation: "",
};

export function ManpowerInvoiceWorkLocation({ control }: { control: Control<any> }) {
  return (
    <FormField control={control} name="manpowerDetails.workLocation" render={({ field }) => (
      <FormItem>
        <FormLabel>Work Location / Site</FormLabel>
        <FormControl><Input {...field} value={field.value || ""} /></FormControl>
      </FormItem>
    )} />
  );
}

export function ManpowerSalesCustomerFields({ control }: { control: Control<any> }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <FormField control={control} name="manpowerDetails.customerPoNumber" render={({ field }) => (
        <FormItem>
          <FormLabel>Customer PO Number</FormLabel>
          <FormControl><Input {...field} value={field.value || ""} /></FormControl>
        </FormItem>
      )} />
      <FormField control={control} name="manpowerDetails.customerPoDate" render={({ field }) => (
        <FormItem>
          <FormLabel>Customer PO Date</FormLabel>
          <FormControl>
            <SyncBridgeDatePicker value={field.value || ""} onChange={field.onChange} placeholder="DD/MM/YYYY" />
          </FormControl>
        </FormItem>
      )} />
      <FormField control={control} name="manpowerDetails.workLocation" render={({ field }) => (
        <FormItem>
          <FormLabel>Work Location / Site</FormLabel>
          <FormControl><Input {...field} value={field.value || ""} /></FormControl>
        </FormItem>
      )} />
    </div>
  );
}

export function ManpowerSalesDateFields({ control, children }: { control: Control<any>; children?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <FormField control={control} name="manpowerDetails.poDate" render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel>PO Date</FormLabel>
          <FormControl>
            <SyncBridgeDatePicker value={field.value || ""} onChange={field.onChange} placeholder="DD/MM/YYYY" />
          </FormControl>
        </FormItem>
      )} />
      {children}
    </div>
  );
}
