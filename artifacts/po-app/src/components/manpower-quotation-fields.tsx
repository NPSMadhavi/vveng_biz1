import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { z } from "zod";
import { useFormContext, useWatch, type Control } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SyncBridgeDatePicker } from "@/components/ui/sync-bridge-date-picker";

export const BILLING_TYPES = ["Hourly", "Daily", "Monthly"];
const CREATE_DESIGNATION = "__create__";

export const manpowerDetailsSchema = z.object({
  phone: z.string().optional(),
  workLocation: z.string().optional(),
  serviceStartDate: z.string().optional(),
  serviceEndDate: z.string().optional(),
  source: z.enum(["own", "supplier"]).optional(),
  designation: z.string().optional(),
  workers: z.string().optional(),
  hours: z.string().optional(),
  billingType: z.string().optional(),
  customerRate: z.string().optional(),
  standardHours: z.string().optional(),
  weekdayOtRate: z.string().optional(),
  supplierRate: z.string().optional(),
  workingDates: z.string().optional(),
  otSupplierRate: z.string().optional(),
});

export const emptyManpowerDetails = {
  phone: "",
  workLocation: "",
  serviceStartDate: "",
  serviceEndDate: "",
  source: "own" as const,
  designation: "",
  workers: "",
  hours: "",
  billingType: "Hourly",
  customerRate: "",
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
          <FormLabel>Phone Number</FormLabel>
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
  const hourly = String(item?.uom || "").toLowerCase().startsWith("hour");
  const factor = hourly && hours > 0 ? hours : 1;
  const disc = Number(item?.discount) || 0;
  return (Number(item?.qty) || 0) * factor * (Number(item?.unitPrice) || 0) * (1 - disc / 100);
}

function blankManpowerLine(details: {
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
}: {
  control: Control<any>;
  onAddLine?: (line: ReturnType<typeof blankManpowerLine>) => void;
}) {
  const source = useWatch({ control, name: "manpowerDetails.source" }) || "own";
  const showSupplierFields = source === "supplier";
  const { getValues, setValue } = useFormContext();
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const draftNameRef = useRef("");
  const [created, setCreated] = useState<string[]>([]);
  const [addError, setAddError] = useState("");
  const lineItems = useWatch({ control, name: "items" }) || [];
  const designationOptions = useMemo(() => {
    const fromLines = (lineItems as Array<{ description?: string }>)
      .map((item) => String(item?.description || "").trim())
      .filter(Boolean);
    return Array.from(new Set([...created, ...fromLines]));
  }, [created, lineItems]);

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
        <FormField control={control} name="manpowerDetails.source" render={({ field }) => (
          <FormItem>
            <FormLabel>Manpower Source</FormLabel>
            <FormControl>
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
            </FormControl>
          </FormItem>
        )} />
        <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-3">
        <FormField control={control} name="manpowerDetails.designation" render={({ field }) => (
          <FormItem className="min-w-0">
            <FormLabel>Designation</FormLabel>
              {creating ? (
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
          <FormField control={control} name="manpowerDetails.hours" render={({ field }) => (
            <FormItem>
              <FormLabel>Number of Hours</FormLabel>
              <FormControl><Input inputMode="decimal" {...field} value={field.value || ""} onKeyDown={addOnEnter} /></FormControl>
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
              <FormLabel>Customer Rate (SGD)</FormLabel>
              <FormControl><Input inputMode="decimal" {...field} value={field.value || ""} onKeyDown={addOnEnter} /></FormControl>
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
              <FormLabel>OT Customer Rate</FormLabel>
              <FormControl><Input inputMode="decimal" {...field} value={field.value || ""} onKeyDown={addOnEnter} /></FormControl>
            </FormItem>
          )} />
        </div>
          {showSupplierFields && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField control={control} name="manpowerDetails.supplierRate" render={({ field }) => (
            <FormItem className="min-w-0">
              <FormLabel>Supplier Rate</FormLabel>
              <FormControl><Input inputMode="decimal" {...field} value={field.value || ""} onKeyDown={addOnEnter} /></FormControl>
            </FormItem>
          )} />
          <FormField control={control} name="manpowerDetails.workingDates" render={({ field }) => (
            <FormItem className="min-w-0">
              <FormLabel>Working Days</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} onKeyDown={addOnEnter} /></FormControl>
            </FormItem>
          )} />
          <FormField control={control} name="manpowerDetails.otSupplierRate" render={({ field }) => (
            <FormItem className="min-w-0">
              <FormLabel>OT Supplier Rate</FormLabel>
              <FormControl><Input inputMode="decimal" {...field} value={field.value || ""} onKeyDown={addOnEnter} /></FormControl>
            </FormItem>
          )} />
          </div>
          )}
      </CardContent>
    </Card>
  );
}

export const salesManpowerSchema = z.object({
  customerPoNumber: z.string().optional(),
  customerPoDate: z.string().optional(),
  workLocation: z.string().optional(),
  poStartDate: z.string().optional(),
  poEndDate: z.string().optional(),
});

export const emptySalesManpower = {
  customerPoNumber: "",
  customerPoDate: "",
  workLocation: "",
  poStartDate: "",
  poEndDate: "",
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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.8fr)]">
      <FormField control={control} name="manpowerDetails.poStartDate" render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel>PO Start Date</FormLabel>
          <FormControl>
            <SyncBridgeDatePicker value={field.value || ""} onChange={field.onChange} placeholder="DD/MM/YYYY" />
          </FormControl>
        </FormItem>
      )} />
      <FormField control={control} name="manpowerDetails.poEndDate" render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel>PO End Date</FormLabel>
          <FormControl>
            <SyncBridgeDatePicker value={field.value || ""} onChange={field.onChange} placeholder="DD/MM/YYYY" />
          </FormControl>
        </FormItem>
      )} />
      {children}
    </div>
  );
}
