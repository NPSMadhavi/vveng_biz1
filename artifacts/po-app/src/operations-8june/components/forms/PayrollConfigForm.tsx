import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/operations-8june/lib/queryClient";
import { insertEmployeePayrollSchema } from "@shared/schema";
import {
  Calculator,
  Check,
  ChevronDown,
  DollarSign,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModalSectionHeader } from "@/operations-8june/components/forms/FormModalShell";
import { EmployeeCombobox } from "@/operations-8june/components/forms/EmployeeCombobox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/date-range";
import { useWorkingYearBounds } from "@/components/financial-year-controls";
import { TooltipProvider } from "@/components/ui/tooltip";
import { calculateSyncBridgePayrollPreview, CPF_WAGE_CEILING } from "@/operations-8june/lib/payroll-utils";
import { listEmployeePayrollMonths, recordPayrollMonthYear } from "@/operations-8june/lib/payroll-batch-utils";
import {
  payrollCancelButtonClass,
  payrollPrimaryButtonClass,
} from "@/operations-8june/lib/payroll-ui";
import {
  deploymentEmployees,
  loadDeployments,
} from "@/pages/manpower/deployment-store";
import { consolidateEmployeeMonthTimesheets, type CustomerHoursRow } from "@/operations-8june/lib/timesheet-cpf-consolidation";

const optionalAmount = z.preprocess((val) => {
  if (val === "" || val === null || val === undefined) return undefined;
  const num = Number(val);
  return Number.isNaN(num) ? undefined : num;
}, z.number().optional());

const payrollConfigSchema = insertEmployeePayrollSchema
  .omit({ tenantId: true, tenantSlug: true, createdBy: true })
  .extend({
  baseSalary: z.coerce.number().min(1, "Basic salary is required"),
  hourlyRate: optionalAmount,
  overtimeRate: optionalAmount,
  citizenshipStatus: z.enum(["citizen", "pr", "foreigner"]).default("citizen"),
  citizenshipDisplay: z.string().optional(),
  age: z.coerce.number().min(16, "Employee must be at least 16 years old").optional(),
  dateOfBirth: z.string().optional(),
  workingDays: optionalAmount,
  allowanceTransport: optionalAmount,
  allowanceMeal: optionalAmount,
  allowancePhone: optionalAmount,
  allowanceOthers: optionalAmount,
  deductionMedical: optionalAmount,
  deductionAdvance: optionalAmount,
  deductionOthers: optionalAmount,
});

type PayrollConfigFormData = z.infer<typeof payrollConfigSchema>;

interface PayrollConfigFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  editData?: any;
}

function calculateAge(dateOfBirth: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = today.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dateOfBirth.getDate())) {
    age -= 1;
  }
  return age;
}

function mapNationalityToCitizenship(nationality?: string): "citizen" | "pr" | "foreigner" {
  if (!nationality) return "citizen";
  const value = nationality.toLowerCase();
  if (value === "singapore") return "citizen";
  if (value === "pr") return "pr";
  if (value === "foreigner") return "foreigner";
  return "foreigner";
}

function formatCitizenshipDisplay(employee: any): string {
  if (employee?.nationality === "PR") {
    if (employee?.prStatus === "1 Year") return "PR - 1";
    if (employee?.prStatus === "2 Years") return "PR - 2";
    if (employee?.prStatus === "3 Years and Above") return "PR - 3+";
    return "PR";
  }
  if (employee?.nationality === "Singapore") return "Singapore Citizen";
  if (employee?.nationality === "Foreigner") return "Foreigner";
  return employee?.nationality || "";
}

function formatNationalityDisplay(employee: any): string {
  // Nationality only — PR years belong in PR Status
  return employee?.nationality || "-";
}

function formatPrStatusDisplay(prStatus?: string): string {
  if (!prStatus) return "-";
  if (prStatus === "1 Year") return "1 Year PR";
  if (prStatus === "2 Years") return "2 Year PR";
  if (prStatus === "3 Years and Above") return "3+ Year PR";
  return prStatus;
}

function formatDisplayDate(value?: string | Date | null): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB");
}

function toDateInputValue(value?: string | Date | null): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().split("T")[0];
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
  }).format(amount || 0);
}

function roundMoney(amount: number) {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

const ALL_EMPLOYEES_ID = 0;

const PAYROLL_MONTH_OPTIONS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
] as const;

/** Months of the open financial year, with the calendar year on each label. Months before the year starts stay disabled. */
function financialYearMonthChoices(from: string, to: string) {
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);
  if (!start || !end || end < start) {
    const year = new Date().getFullYear();
    return PAYROLL_MONTH_OPTIONS.map((month) => ({
      month: month.value,
      year,
      label: `${month.label} ${year}`,
      enabled: true,
    }));
  }
  const choices: { month: number; year: number; label: string; enabled: boolean }[] = [];
  const startMonth = start.getMonth() + 1;
  const startYear = start.getFullYear();
  for (let month = 1; month < startMonth; month += 1) {
    const name = PAYROLL_MONTH_OPTIONS[month - 1].label;
    choices.push({ month, year: startYear, label: `${name} ${startYear}`, enabled: false });
  }
  const cursor = new Date(startYear, start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last && choices.length < 24) {
    const month = cursor.getMonth() + 1;
    const year = cursor.getFullYear();
    const name = PAYROLL_MONTH_OPTIONS[month - 1].label;
    choices.push({ month, year, label: `${name} ${year}`, enabled: true });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return choices;
}

/** Calendar days in a month (28/29/30/31) for the given year. */
function getDaysInMonth(month: number, year = new Date().getFullYear()): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 30;
  return new Date(year, month, 0).getDate();
}

const HOURS_PER_WORKING_DAY = 8;

/** Monday to Friday in the selected month. */
function countWeekdays(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 0;
  const days = new Date(year, month, 0).getDate();
  let count = 0;
  for (let day = 1; day <= days; day += 1) {
    const dow = new Date(year, month - 1, day).getDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

/**
 * Prorated basic for CPF / pay:
 * (monthly salary ÷ days in selected month) × working days
 * Example: $3,100 ÷ 31 × 30 ≠ $3,100 ÷ 30 × 30
 */
function calcBasicSalaryForCpf(
  baseSalary: number,
  workingDays?: number | null,
  monthDays?: number | null
): number {
  const base = Number(baseSalary) || 0;
  if (base <= 0) return 0;

  const days = Number(workingDays);
  if (!Number.isFinite(days) || days <= 0) {
    return Math.round(base * 100) / 100;
  }

  const rawMonthDays = Number(monthDays);
  const divisor =
    Number.isFinite(rawMonthDays) && rawMonthDays > 0 ? rawMonthDays : days;
  if (divisor <= 0) return Math.round(base * 100) / 100;

  const prorated = (base / divisor) * days;
  // Never pay more than the configured monthly basic.
  return Math.round(Math.min(base, prorated) * 100) / 100;
}

function formatRatePercent(rate: number): string {
  return `${rate}%`;
}

const formLabelClass = "text-sm font-medium text-[#111827]";
const payheadLabelClass = "text-base font-medium text-[#111827]";
const readOnlyInputClass = "bg-[#F8FAFC] text-[#111827]";

type Payhead = { id: string; label: string };
type PayheadKind = "earning" | "deduction";
type PayheadStore = { renames: Record<string, string>; hidden: string[]; custom: Payhead[] };

const BUILTIN_EARNINGS: Payhead[] = [
  { id: "transport", label: "Travelling Allowance" },
  { id: "meal", label: "Food Allowance" },
  { id: "phone", label: "Mobile Allowance" },
  { id: "others", label: "Other Allowance" },
  { id: "bonus", label: "Bonus / AWS" },
  { id: "income_tax_borne_by_employee", label: "Income Tax Borne by Employee" },
];
const BUILTIN_DEDUCTIONS: Payhead[] = [
  { id: "medical", label: "Medical Insurance" },
  { id: "advance", label: "Advanced / Loan Recovery" },
  { id: "others", label: "Other Deductions" },
];
const RESERVED_EARNING_IDS = new Set([
  "transport",
  "meal",
  "phone",
  "others",
  "overtime",
  "bonus",
  "income_tax_borne_by_employee",
  "hourlyNormalRate",
  "hourlyNormalHours",
  "hourlyActualHours",
  "hourlyNormalPay",
  "perHourCharge",
  "normalWorkingDays",
  "actualWorkingDays",
  "hourlyOtDays",
  "hourlyOtRate",
  "assignedCustomerId",
  "assignedCustomerName",
]);
const SEPARATE_EARNING_IDS = new Set(["bonus", "income_tax_borne_by_employee"]);
const RESERVED_DEDUCTION_IDS = new Set(["medical", "advance", "others"]);
const EARNING_FORM_FIELDS: Record<string, "allowanceTransport" | "allowanceMeal" | "allowancePhone" | "allowanceOthers"> = {
  transport: "allowanceTransport",
  meal: "allowanceMeal",
  phone: "allowancePhone",
  others: "allowanceOthers",
};
const DEDUCTION_FORM_FIELDS: Record<string, "deductionMedical" | "deductionAdvance" | "deductionOthers"> = {
  medical: "deductionMedical",
  advance: "deductionAdvance",
  others: "deductionOthers",
};

function emptyPayheadStore(): PayheadStore {
  return { renames: {}, hidden: [], custom: [] };
}

function payheadStorageKey(kind: PayheadKind) {
  return kind === "earning" ? "payroll-payhead-earnings" : "payroll-payhead-deductions";
}

function loadPayheadStore(kind: PayheadKind): PayheadStore {
  try {
    const raw = localStorage.getItem(payheadStorageKey(kind));
    if (!raw) return emptyPayheadStore();
    const parsed = JSON.parse(raw) as Partial<PayheadStore>;
    return {
      renames: parsed.renames && typeof parsed.renames === "object" ? parsed.renames : {},
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((id) => typeof id === "string") : [],
      custom: Array.isArray(parsed.custom)
        ? parsed.custom.filter((item) => item && typeof item.id === "string" && typeof item.label === "string")
        : [],
    };
  } catch {
    return emptyPayheadStore();
  }
}

function savePayheadStore(kind: PayheadKind, store: PayheadStore) {
  localStorage.setItem(payheadStorageKey(kind), JSON.stringify(store));
}

function visiblePayheads(kind: PayheadKind, store: PayheadStore): Payhead[] {
  const builtins = kind === "earning" ? BUILTIN_EARNINGS : BUILTIN_DEDUCTIONS;
  const reserved = kind === "earning" ? RESERVED_EARNING_IDS : RESERVED_DEDUCTION_IDS;
  const hidden = new Set(store.hidden);
  const builtinItems = builtins
    .filter((item) => !hidden.has(item.id))
    .map((item) => ({ id: item.id, label: store.renames[item.id] || item.label }));
  const customItems = store.custom
    .filter((item) => !hidden.has(item.id) && !reserved.has(item.id))
    .map((item) => ({ id: item.id, label: store.renames[item.id] || item.label }));
  return [...builtinItems, ...customItems];
}

function slugifyPayhead(label: string) {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return base || "payhead";
}

function labelFromPayheadId(id: string) {
  return id.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function mergeSavedPayheads(kind: PayheadKind, amounts: Record<string, unknown> | null | undefined): PayheadStore {
  const store = loadPayheadStore(kind);
  const reserved = kind === "earning" ? RESERVED_EARNING_IDS : RESERVED_DEDUCTION_IDS;
  const hidden = new Set(store.hidden);
  let changed = false;
  for (const key of Object.keys(amounts || {})) {
    if (reserved.has(key) || hidden.has(key) || store.custom.some((item) => item.id === key)) continue;
    store.custom.push({ id: key, label: labelFromPayheadId(key) });
    changed = true;
  }
  if (changed) savePayheadStore(kind, store);
  return store;
}

function PayheadMenu({
  buttonLabel,
  buttonClassName,
  items,
  onCreate,
  onEdit,
  onDelete,
}: {
  buttonLabel: string;
  buttonClassName: string;
  items: Payhead[];
  onCreate: () => void;
  onEdit: (item: Payhead) => void;
  onDelete: (item: Payhead) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={buttonClassName}>
          <Plus className="mr-1 h-4 w-4" />
          {buttonLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem
          onSelect={onCreate}
          className="font-medium text-[#2563EB] focus:bg-[#EFF6FF] focus:text-[#2563EB]"
        >
          Create new payhead
        </DropdownMenuItem>
        {items.length > 0 ? <DropdownMenuSeparator /> : null}
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-1 px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-sm text-[#111827]">{item.label}</span>
            <button
              type="button"
              className="rounded p-1 text-[#2563EB] hover:bg-[#EFF6FF]"
              title={`Edit ${item.label}`}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                onEdit(item);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="rounded p-1 text-[#DC2626] hover:bg-[#FEF2F2]"
              title={`Delete ${item.label}`}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                onDelete(item);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OptionalAmountInput({
  field,
  placeholder = "",
}: {
  field: { value?: number; onChange: (value: number | undefined) => void; onBlur?: () => void; name: string; ref?: React.Ref<HTMLInputElement> };
  placeholder?: string;
}) {
  return (
    <Input
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={field.value === undefined || field.value === null ? "" : field.value}
      onChange={(e) => {
        const v = e.target.value;
        if (v !== "" && !/^\d*\.?\d*$/.test(v)) return;
        field.onChange(v === "" ? undefined : Number(v));
      }}
      onBlur={field.onBlur}
      name={field.name}
      ref={field.ref}
    />
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-[#2563EB]">{label}</p>
      <p className="mt-1 text-base font-semibold text-[#111827]">{value}</p>
    </div>
  );
}

function mapConfigToFormValues(config: any): Partial<PayrollConfigFormData> {
  if (!config) return {};
  const allowances = config.allowances || {};
  const deductions = config.deductions || {};
  const toNum = (val: unknown) =>
    val != null && val !== "" ? Number(val) : undefined;
  return {
    employeeId: Number(config.employeeId) || undefined,
    baseSalary: Number(config.baseSalary) || undefined,
    payrollPeriod: config.payrollPeriod || "monthly",
    hourlyRate: toNum(config.hourlyRate),
    overtimeRate: toNum(config.overtimeRate),
    allowanceTransport: toNum(allowances.transport),
    allowanceMeal: toNum(allowances.meal),
    allowancePhone: toNum(allowances.phone),
    allowanceOthers: toNum(allowances.others),
    deductionMedical: toNum(deductions.medical),
    deductionAdvance: toNum(deductions.advance),
    deductionOthers: toNum(deductions.others),
    workingDays: toNum(config.noOfWorkingDays),
    isActive: config.isActive ?? true,
    effectiveFrom: config.effectiveFrom
      ? String(config.effectiveFrom).split("T")[0]
      : new Date().toISOString().split("T")[0],
    effectiveTo: config.effectiveTo ? String(config.effectiveTo).split("T")[0] : undefined,
  };
}

function buildPayrollConfigPayload(
  data: PayrollConfigFormData,
  selectedEmployee: any,
  citizenshipStatus: string,
  age: number,
  monthDays?: number | null,
  extraAllowances: Record<string, number> = {},
  extraDeductions: Record<string, number> = {},
  includedEarnings: string[] = ["transport", "meal", "phone", "others"],
  includedDeductions: string[] = ["medical", "advance", "others"],
) {
  const {
    age: _age,
    citizenshipStatus: _citizenshipStatus,
    citizenshipDisplay,
    dateOfBirth,
    workingDays,
    allowanceTransport,
    allowanceMeal,
    allowancePhone,
    allowanceOthers,
    deductionMedical,
    deductionAdvance,
    deductionOthers,
    ...payrollData
  } = data;

  const earningIncluded = new Set(includedEarnings);
  const deductionIncluded = new Set(includedDeductions);
  const allowances: Record<string, number> = {
    // Overtime Hours × Overtime pay (SGD) — counted with allowances
    overtime: Math.round(
      (Number(payrollData.overtimeRate) || 0) * (Number(payrollData.hourlyRate) || 0) * 100
    ) / 100,
  };
  if (earningIncluded.has("transport")) allowances.transport = allowanceTransport || 0;
  if (earningIncluded.has("meal")) allowances.meal = allowanceMeal || 0;
  if (earningIncluded.has("phone")) allowances.phone = allowancePhone || 0;
  if (earningIncluded.has("others")) allowances.others = allowanceOthers || 0;
  for (const [key, value] of Object.entries(extraAllowances)) {
    if (!RESERVED_EARNING_IDS.has(key) || SEPARATE_EARNING_IDS.has(key)) {
      allowances[key] = Number(value) || 0;
    }
  }

  const deductions: Record<string, number> = {};
  if (deductionIncluded.has("medical")) deductions.medical = deductionMedical || 0;
  if (deductionIncluded.has("advance")) deductions.advance = deductionAdvance || 0;
  if (deductionIncluded.has("others")) deductions.others = deductionOthers || 0;
  for (const [key, value] of Object.entries(extraDeductions)) {
    if (!RESERVED_DEDUCTION_IDS.has(key)) deductions[key] = Number(value) || 0;
  }

  const overtimePay = Number(allowances.overtime) || 0;
  const previewAllowances = { ...allowances };
  delete previewAllowances.overtime;

  const calculation = calculateSyncBridgePayrollPreview({
    monthlySalary: calcBasicSalaryForCpf(
      Number(payrollData.baseSalary) || 0,
      workingDays != null ? Number(workingDays) : undefined,
      monthDays
    ),
    age,
    citizenshipStatus: citizenshipStatus as "citizen" | "pr" | "foreigner",
    prStatus: selectedEmployee?.prStatus,
    overtimePay,
    allowances: previewAllowances,
    deductions,
  });

  return {
    ...payrollData,
    baseSalary: String(payrollData.baseSalary),
    hourlyRate:
      payrollData.hourlyRate != null ? String(payrollData.hourlyRate) : undefined,
    overtimeRate:
      payrollData.overtimeRate != null ? String(payrollData.overtimeRate) : undefined,
    effectiveTo: payrollData.effectiveTo || undefined,
    noOfWorkingDays: workingDays != null ? Number(workingDays) : undefined,
    allowances,
    deductions,
    cpfRate: String(calculation.employeeRate),
    cpfAmount: String(calculation.employeeCpf),
    employerCpfRate: String(calculation.employerRate),
    employerCpfAmount: String(calculation.employerCpf),
    netSalary: String(calculation.netPay),
    taxRate: getTaxRateStatic(Number(data.baseSalary) * 12),
  };
}

function getTaxRateStatic(annualSalary: number): string {
  if (annualSalary <= 20000) return "0.00";
  if (annualSalary <= 30000) return "2.00";
  if (annualSalary <= 40000) return "3.50";
  if (annualSalary <= 80000) return "7.00";
  if (annualSalary <= 120000) return "11.50";
  if (annualSalary <= 160000) return "15.00";
  if (annualSalary <= 200000) return "18.00";
  return "22.00";
}

export default function PayrollConfigForm({ onSuccess, onCancel, editData }: PayrollConfigFormProps) {
  const { toast } = useToast();

  const { data: employees = [], isLoading: employeesLoading } = useQuery<any[]>({
    queryKey: ["/api/employees"],
  });

  const activeEmployees = useMemo(
    () => employees.filter((employee) => String(employee.status || "active") === "active"),
    [employees],
  );

  const employeeOptions = useMemo(() => {
    const options = [...employees];
    if (editData?.employeeId) {
      const editEmployeeId = Number(editData.employeeId);
      const alreadyListed = options.some((employee) => Number(employee.id) === editEmployeeId);
      if (!alreadyListed) {
        options.unshift({
          id: editEmployeeId,
          employeeId: editData.employeeCode ?? editData.employeeId,
          name: editData.employeeName ?? "Selected employee",
          department: editData.department ?? "",
          designation: editData.designation ?? "",
          nationality: editData.nationality,
          prStatus: editData.prStatus,
          salary: editData.baseSalary,
          annualSalary: String((Number(editData.baseSalary) || 0) * 12),
        });
      }
    }
    if (editData?.id) return options;
    return [
      {
        id: ALL_EMPLOYEES_ID,
        name: "All Employees",
        employeeId: `${activeEmployees.length} active`,
        designation: "Process payroll for everyone",
      },
      ...options,
    ];
  }, [employees, editData, activeEmployees.length]);

  const form = useForm<PayrollConfigFormData>({
    resolver: zodResolver(payrollConfigSchema),
    defaultValues: {
      payrollPeriod: "monthly",
      citizenshipStatus: "citizen",
      citizenshipDisplay: "",
      dateOfBirth: "",
      isActive: true,
      effectiveFrom: new Date().toISOString().split("T")[0],
    },
  });

  const isEditMode = Boolean(editData?.id);
  const [selectedPayrollMonth, setSelectedPayrollMonth] = useState<number | null>(null);
  const [monthMenuOpen, setMonthMenuOpen] = useState(false);
  const [monthError, setMonthError] = useState("");
  const [earningStore, setEarningStore] = useState<PayheadStore>(() => loadPayheadStore("earning"));
  const [deductionStore, setDeductionStore] = useState<PayheadStore>(() => loadPayheadStore("deduction"));
  const [customEarningAmounts, setCustomEarningAmounts] = useState<Record<string, number | undefined>>({});
  const [customDeductionAmounts, setCustomDeductionAmounts] = useState<Record<string, number | undefined>>({});
  const [payheadDialog, setPayheadDialog] = useState<{
    kind: PayheadKind;
    mode: "create" | "edit";
    id?: string;
    label: string;
  } | null>(null);
  const [payheadName, setPayheadName] = useState("");

  const earningCatalog = useMemo(() => visiblePayheads("earning", earningStore), [earningStore]);
  const deductionCatalog = useMemo(() => visiblePayheads("deduction", deductionStore), [deductionStore]);

  const selectedEmployeeId = form.watch("employeeId");
  const isAllEmployees = String(selectedEmployeeId) === String(ALL_EMPLOYEES_ID);
  const selectedEmployee = useMemo(
    () =>
      isAllEmployees
        ? undefined
        : employeeOptions.find(
            (employee) => Number(employee.id) === Number(selectedEmployeeId)
          ),
    [employeeOptions, selectedEmployeeId, isAllEmployees]
  );

  const { data: payrollRecords = [] } = useQuery<any[]>({
    queryKey: ["/api/payroll/records"],
  });

  const { data: customers = [] } = useQuery<any[]>({
    queryKey: ["/api/customers"],
  });

  const [customerId, setCustomerId] = useState("");
  const [selectedCustomerPartyKey, setSelectedCustomerPartyKey] = useState("");
  const [hourlyRateInput, setHourlyRateInput] = useState("");
  const [normalHours, setNormalHours] = useState("");
  const [actualHours, setActualHours] = useState("");
  const [selectedTsOt15, setSelectedTsOt15] = useState(0);
  const [selectedTsOt20, setSelectedTsOt20] = useState(0);
  const [selectedTsRest, setSelectedTsRest] = useState(0);
  const [selectedTsPh, setSelectedTsPh] = useState(0);
  const [deploymentTick, setDeploymentTick] = useState(0);

  useEffect(() => {
    const refresh = () => setDeploymentTick((n) => n + 1);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  /** Customer-side employee deployments → partyId (customer) ↔ employee DB ids */
  const deploymentLinks = useMemo(() => {
    void deploymentTick;
    const rows = loadDeployments().filter((row) => row.side === "customer");
    const customerToEmployees = new Map<string, Set<number>>();
    const employeeToCustomers = new Map<number, Set<string>>();
    for (const row of rows) {
      const partyKey = String(row.partyId || "").trim();
      if (!partyKey) continue;
      for (const person of deploymentEmployees(row)) {
        const employeeKey = Number(person.id);
        if (!Number.isFinite(employeeKey)) continue;
        if (!customerToEmployees.has(partyKey)) customerToEmployees.set(partyKey, new Set());
        customerToEmployees.get(partyKey)!.add(employeeKey);
        if (!employeeToCustomers.has(employeeKey)) employeeToCustomers.set(employeeKey, new Set());
        employeeToCustomers.get(employeeKey)!.add(partyKey);
      }
    }
    return { customerToEmployees, employeeToCustomers };
  }, [deploymentTick]);

  const applyCustomerHoursRow = (row: CustomerHoursRow) => {
    const partyKey = String(row.partyId || row.customerName || "");
    setSelectedCustomerPartyKey(partyKey);
    if (row.partyId) setCustomerId(String(row.partyId));
    const days = row.workingDays > 0 ? row.workingDays : Math.max(1, Math.round(row.normal / HOURS_PER_WORKING_DAY) || 0);
    if (days > 0) {
      form.setValue("workingDays", days, { shouldDirty: true, shouldValidate: true });
    }
    const normal = Math.round(row.normal * 100) / 100;
    const total = Math.round(row.totalHours * 100) / 100;
    if (normal > 0) setNormalHours(String(normal));
    if (total > 0) setActualHours(String(total));
    const ot = Math.round((row.ot15 + row.ot20 + row.restDay + row.publicHoliday) * 100) / 100;
    setSelectedTsOt15(Math.round(row.ot15 * 100) / 100);
    setSelectedTsOt20(Math.round(row.ot20 * 100) / 100);
    setSelectedTsRest(Math.round(row.restDay * 100) / 100);
    setSelectedTsPh(Math.round(row.publicHoliday * 100) / 100);
    form.setValue("overtimeRate", ot > 0 ? ot : undefined, { shouldDirty: true, shouldValidate: true });
  };

  const [selectedPayrollYear, setSelectedPayrollYear] = useState<number>(new Date().getFullYear());
  const savedMonths = useMemo(
    () => listEmployeePayrollMonths(payrollRecords, Number(selectedEmployeeId) || 0),
    [payrollRecords, selectedEmployeeId],
  );
  const timesheetCustomers = useMemo((): CustomerHoursRow[] => {
    if (!selectedEmployee || isAllEmployees || selectedPayrollMonth == null) return [];
    return consolidateEmployeeMonthTimesheets({
      employeeId: selectedEmployee.id,
      employeeCode: selectedEmployee.employeeId,
      employeeLabel: selectedEmployee.name,
      year: selectedPayrollYear,
      month: selectedPayrollMonth,
      requireApproved: false,
    }).customers;
  }, [selectedEmployee, isAllEmployees, selectedPayrollMonth, selectedPayrollYear]);

  const workingYear = useWorkingYearBounds();
  const payrollMonthChoices = useMemo(
    () => financialYearMonthChoices(workingYear.from, workingYear.to),
    [workingYear.from, workingYear.to],
  );
  const selectedMonthLabel =
    payrollMonthChoices.find(
      (month) => month.month === selectedPayrollMonth && month.year === selectedPayrollYear,
    )?.label ?? "Select month";

  const applyMonthSelection = (month: number, year = new Date().getFullYear()) => {
    setSelectedPayrollMonth(month);
    setSelectedPayrollYear(year);
    setMonthError("");
    setMonthMenuOpen(false);
    setSelectedCustomerPartyKey("");
    setCustomerId("");
    const hourly = String(selectedEmployee?.workType || "") === "hourly";
    const weekdays = countWeekdays(year, month);
    form.setValue("workingDays", hourly ? weekdays : getDaysInMonth(month, year), {
      shouldDirty: true,
      shouldValidate: true,
    });

    const saved = savedMonths.find((item) => item.year === year && item.month === month);
    const record = payrollRecords.find((item) => {
      const period = recordPayrollMonthYear(item);
      return (
        Number(item.employeeId) === Number(selectedEmployeeId) &&
        period.year === year &&
        period.month === month
      );
    });
    if (!editData?.id && saved) {
      setMonthError("Already month completed");
      toast({
        title: "Already month completed",
        description: "This month's payroll is already created. Use Edit to change it.",
        variant: "destructive",
      });
    } else {
      setMonthError("");
    }
    if (hourly) {
      const savedAllowances = (saved?.allowances || record?.allowances || {}) as Record<string, unknown>;
      if (savedAllowances.hourlyNormalHours != null && savedAllowances.hourlyNormalHours !== "") {
        setNormalHours(String(savedAllowances.hourlyNormalHours));
      }
      if (savedAllowances.hourlyActualHours != null && savedAllowances.hourlyActualHours !== "") {
        setActualHours(String(savedAllowances.hourlyActualHours));
      }
    } else {
      const savedSalary = saved?.basic || Number(record?.baseSalary);
      const employeeSalary = parseFloat(selectedEmployee?.salary || "0") || 0;
      const salary = savedSalary > 0 ? savedSalary : employeeSalary;
      if (salary > 0) {
        form.setValue("baseSalary", salary, { shouldDirty: true, shouldValidate: true });
      }
    }
    const allowances = (saved?.allowances || record?.allowances || {}) as Record<string, number>;
    const deductions = (saved?.deductions || record?.deductions || {}) as Record<string, number>;
    const amountOrEmpty = (value: unknown) => {
      const amount = Number(value);
      return amount > 0 ? amount : undefined;
    };
    form.setValue("allowanceTransport", amountOrEmpty(allowances.transport));
    form.setValue("allowanceMeal", amountOrEmpty(allowances.meal));
    form.setValue("allowancePhone", amountOrEmpty(allowances.phone));
    form.setValue("allowanceOthers", amountOrEmpty(allowances.others));
    form.setValue("deductionMedical", amountOrEmpty(deductions.medical));
    form.setValue("deductionAdvance", amountOrEmpty(deductions.advance));
    form.setValue("deductionOthers", amountOrEmpty(deductions.others));
  };

  const baseSalary = Number(form.watch("baseSalary") || 0);
  const workingDaysRaw = form.watch("workingDays");
  const selectedMonthDays =
    selectedPayrollMonth != null ? getDaysInMonth(selectedPayrollMonth) : null;
  const age = Number(form.watch("age") || 0);
  const citizenshipStatus = form.watch("citizenshipStatus");
  const overtimeHours = Number(form.watch("overtimeRate") || 0); // field labeled Overtime Hours
  const forHoursInSgd = Number(form.watch("hourlyRate") || 0); // field labeled Overtime pay (SGD)
  const isHourlyEmployee = String(selectedEmployee?.workType || "") === "hourly";
  const customersForEmployee = useMemo(() => {
    if (!selectedEmployee || isAllEmployees) return [];
    const employeeId = Number(selectedEmployee.id);
    const partyIds = deploymentLinks.employeeToCustomers.get(employeeId);
    if (!partyIds || partyIds.size === 0) return [];
    return customers.filter((customer) => partyIds.has(String(customer.id)));
  }, [customers, selectedEmployee, isAllEmployees, deploymentLinks]);
  // Only show customers linked via Employee Deployment (or all customers when none linked yet for UX empty state)
  const customerChoices = useMemo(() => {
    if (selectedEmployee && !isAllEmployees) {
      return customersForEmployee;
    }
    if (customerId) {
      return customers.filter((customer) => String(customer.id) === customerId);
    }
    // Customers that have at least one deployment
    const deployedPartyIds = deploymentLinks.customerToEmployees;
    const deployed = customers.filter((customer) => deployedPartyIds.has(String(customer.id)));
    return deployed.length > 0 ? deployed : customers;
  }, [selectedEmployee, isAllEmployees, customersForEmployee, customerId, customers, deploymentLinks]);
  const visibleEmployeeOptions = useMemo(() => {
    if (!customerId) return employeeOptions;
    const ids = deploymentLinks.customerToEmployees.get(String(customerId)) || new Set<number>();
    if (ids.size === 0) return employeeOptions;
    const matched = employeeOptions.filter((employee) => ids.has(Number(employee.id)));
    return [
      {
        id: ALL_EMPLOYEES_ID,
        name: "All Employees",
        employeeId: `${matched.length} assigned`,
        designation: "Process payroll for everyone linked to this customer",
      },
      ...matched,
    ];
  }, [customerId, deploymentLinks, employeeOptions]);
  const perHourCharge = Number(selectedEmployee?.perHourCharge) || Number(hourlyRateInput) || 0;
  const hourlyWorkingDays = isHourlyEmployee && selectedPayrollMonth != null
    ? (Number(workingDaysRaw) || countWeekdays(selectedPayrollYear, selectedPayrollMonth))
    : 0;
  const autoNormalHours = hourlyWorkingDays > 0 ? hourlyWorkingDays * HOURS_PER_WORKING_DAY : 0;
  const normalHourlyRate = perHourCharge;
  const normalWorkingHours = normalHours !== "" ? (Number(normalHours) || 0) : autoNormalHours;
  const actualWorkingHours = actualHours === "" ? normalWorkingHours : (Number(actualHours) || 0);
  const normalPay = roundMoney(perHourCharge * normalWorkingHours);
  const classifiedOtHours = roundMoney(selectedTsOt15 + selectedTsOt20 + selectedTsRest + selectedTsPh);
  const hourlyOtHours = classifiedOtHours > 0
    ? classifiedOtHours
    : roundMoney(Math.max(0, actualWorkingHours - normalWorkingHours));
  const hourlyOtRate = roundMoney(normalHourlyRate * 1.5);
  const hourlyOt20Rate = roundMoney(normalHourlyRate * 2);
  const hourlyOtPay = classifiedOtHours > 0
    ? roundMoney(
        selectedTsOt15 * hourlyOtRate
        + selectedTsOt20 * hourlyOt20Rate
        + (selectedTsRest + selectedTsPh) * hourlyOtRate,
      )
    : roundMoney(hourlyOtHours * hourlyOtRate);
  const overtimePay = isHourlyEmployee
    ? hourlyOtPay
    : Math.round(overtimeHours * forHoursInSgd * 100) / 100;
  const basicSalaryForCpf = isHourlyEmployee
    ? normalPay
    : calcBasicSalaryForCpf(
        baseSalary,
        workingDaysRaw,
        selectedMonthDays
      );
  const allowanceTransport = Number(form.watch("allowanceTransport") || 0);
  const allowanceMeal = Number(form.watch("allowanceMeal") || 0);
  const allowancePhone = Number(form.watch("allowancePhone") || 0);
  const allowanceOthers = Number(form.watch("allowanceOthers") || 0);
  const deductionMedical = Number(form.watch("deductionMedical") || 0);
  const deductionAdvance = Number(form.watch("deductionAdvance") || 0);
  const deductionOthers = Number(form.watch("deductionOthers") || 0);

  const allowancePreview = useMemo(() => {
    const visible = new Set(earningCatalog.map((item) => item.id));
    const map: Record<string, number> = {};
    if (visible.has("transport")) map.transport = allowanceTransport;
    if (visible.has("meal")) map.meal = allowanceMeal;
    if (visible.has("phone")) map.phone = allowancePhone;
    if (visible.has("others")) map.others = allowanceOthers;
    for (const item of earningCatalog) {
      if (RESERVED_EARNING_IDS.has(item.id) && !SEPARATE_EARNING_IDS.has(item.id)) continue;
      map[item.id] = Number(customEarningAmounts[item.id]) || 0;
    }
    return map;
  }, [
    earningCatalog,
    allowanceTransport,
    allowanceMeal,
    allowancePhone,
    allowanceOthers,
    customEarningAmounts,
  ]);

  const deductionPreview = useMemo(() => {
    const visible = new Set(deductionCatalog.map((item) => item.id));
    const map: Record<string, number> = {};
    if (visible.has("medical")) map.medical = deductionMedical;
    if (visible.has("advance")) map.advance = deductionAdvance;
    if (visible.has("others")) map.others = deductionOthers;
    for (const item of deductionCatalog) {
      if (RESERVED_DEDUCTION_IDS.has(item.id)) continue;
      map[item.id] = Number(customDeductionAmounts[item.id]) || 0;
    }
    return map;
  }, [
    deductionCatalog,
    deductionMedical,
    deductionAdvance,
    deductionOthers,
    customDeductionAmounts,
  ]);

  const calculationPreview = useMemo(() => {
    if (!baseSalary || !age) return null;

    return calculateSyncBridgePayrollPreview({
      monthlySalary: basicSalaryForCpf,
      age,
      citizenshipStatus,
      prStatus: selectedEmployee?.prStatus,
      overtimePay,
      allowances: allowancePreview,
      deductions: deductionPreview,
    });
  }, [
    baseSalary,
    basicSalaryForCpf,
    age,
    citizenshipStatus,
    selectedEmployee?.prStatus,
    overtimePay,
    allowancePreview,
    deductionPreview,
  ]);
  const populateFromEmployee = (employee: any) => {
    const dob = employee?.dateOfBirth ? new Date(employee.dateOfBirth) : null;
    const monthlySalary = parseFloat(employee?.salary || "0") || 0;

    if (dob) {
      form.setValue("age", calculateAge(dob));
      form.setValue("dateOfBirth", toDateInputValue(dob));
    } else {
      form.setValue("dateOfBirth", "");
    }
    form.setValue("citizenshipStatus", mapNationalityToCitizenship(employee?.nationality));
    form.setValue("citizenshipDisplay", formatCitizenshipDisplay(employee));
    if (monthlySalary > 0) {
      form.setValue("baseSalary", monthlySalary);
    }
  };

  useEffect(() => {
    if (!isEditMode || !editData) return;
    const employee = employeeOptions.find(
      (e) => Number(e.id) === Number(editData.employeeId)
    );
    const mapped = mapConfigToFormValues(editData);
    const dob = employee?.dateOfBirth ? new Date(employee.dateOfBirth) : null;

    form.reset({
      payrollPeriod: "monthly",
      citizenshipStatus: employee
        ? mapNationalityToCitizenship(employee.nationality)
        : "citizen",
      citizenshipDisplay: employee ? formatCitizenshipDisplay(employee) : "",
      dateOfBirth: dob ? toDateInputValue(dob) : "",
      age: dob ? calculateAge(dob) : undefined,
      isActive: true,
      effectiveFrom: new Date().toISOString().split("T")[0],
      ...mapped,
      employeeId: Number(editData.employeeId),
    } as PayrollConfigFormData);
    const savedAllowances = (editData.allowances || {}) as Record<string, unknown>;
    const savedDeductions = (editData.deductions || {}) as Record<string, unknown>;
    setEarningStore(mergeSavedPayheads("earning", savedAllowances));
    setDeductionStore(mergeSavedPayheads("deduction", savedDeductions));
    const extraEarnings: Record<string, number | undefined> = {};
    const extraDeductions: Record<string, number | undefined> = {};
    for (const [key, value] of Object.entries(savedAllowances)) {
      if (!RESERVED_EARNING_IDS.has(key) || SEPARATE_EARNING_IDS.has(key)) {
        extraEarnings[key] = Number(value) || undefined;
      }
    }
    for (const [key, value] of Object.entries(savedDeductions)) {
      if (!RESERVED_DEDUCTION_IDS.has(key)) extraDeductions[key] = Number(value) || undefined;
    }
    setCustomEarningAmounts(extraEarnings);
    setCustomDeductionAmounts(extraDeductions);
  }, [isEditMode, editData, employeeOptions, form]);

  useEffect(() => {
    if (isEditMode || !selectedEmployee) return;
    populateFromEmployee(selectedEmployee);
  }, [selectedEmployee?.id, isEditMode]);

  useEffect(() => {
    const saved = (editData?.allowances || {}) as Record<string, unknown>;
    if (isEditMode && saved.assignedCustomerId != null) {
      setCustomerId(String(saved.assignedCustomerId));
      setSelectedCustomerPartyKey(String(saved.assignedCustomerId));
    }
  }, [selectedEmployee?.id, isEditMode]);

  useEffect(() => {
    if (!isHourlyEmployee) return;
    const charge = selectedEmployee?.perHourCharge;
    setHourlyRateInput(charge != null && String(charge) !== "" ? String(charge) : "");
    setNormalHours("");
    setActualHours("");
  }, [isHourlyEmployee, selectedEmployee?.id]);

  useEffect(() => {
    if (!isHourlyEmployee || selectedPayrollMonth == null) return;
    // Prefer timesheet hours whenever this employee has customer timesheets in the month
    if (timesheetCustomers.length > 0) return;
    const days = countWeekdays(selectedPayrollYear, selectedPayrollMonth);
    const hours = String(days * HOURS_PER_WORKING_DAY);
    form.setValue("workingDays", days, { shouldDirty: true });
    setNormalHours(hours);
    const saved = savedMonths.find((item) => item.year === selectedPayrollYear && item.month === selectedPayrollMonth);
    const record = payrollRecords.find((item) => {
      const period = recordPayrollMonthYear(item);
      return (
        Number(item.employeeId) === Number(selectedEmployeeId) &&
        period.year === selectedPayrollYear &&
        period.month === selectedPayrollMonth
      );
    });
    const savedAllowances = (saved?.allowances || record?.allowances || {}) as Record<string, unknown>;
    const savedActual = savedAllowances.hourlyActualHours;
    setActualHours(savedActual != null && String(savedActual) !== "" ? String(savedActual) : hours);
  }, [isHourlyEmployee, selectedPayrollMonth, selectedPayrollYear, selectedEmployee?.id, selectedCustomerPartyKey, timesheetCustomers.length]);

  useEffect(() => {
    if (!isHourlyEmployee) return;
    if (normalPay <= 0) return;
    form.setValue("baseSalary", normalPay, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [isHourlyEmployee, normalPay]);

  useEffect(() => {
    if (!selectedEmployee || isAllEmployees) {
      setSelectedCustomerPartyKey("");
      setCustomerId("");
      setSelectedTsOt15(0);
      setSelectedTsOt20(0);
      setSelectedTsRest(0);
      setSelectedTsPh(0);
      return;
    }
    if (timesheetCustomers.length === 1) {
      applyCustomerHoursRow(timesheetCustomers[0]);
      return;
    }
    if (timesheetCustomers.length > 1) {
      setSelectedCustomerPartyKey((current) => {
        const still = timesheetCustomers.some((row) => String(row.partyId || row.customerName) === current);
        if (still) return current;
        setCustomerId("");
        return "";
      });
      return;
    }
    // fallback to deployment-linked customers
    if (customersForEmployee.length === 1) {
      setCustomerId(String(customersForEmployee[0].id));
      setSelectedCustomerPartyKey(String(customersForEmployee[0].id));
    } else if (customersForEmployee.length > 1) {
      setCustomerId((current) =>
        customersForEmployee.some((customer) => String(customer.id) === current) ? current : "",
      );
    } else {
      setCustomerId("");
      setSelectedCustomerPartyKey("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmployee?.id, isAllEmployees, timesheetCustomers, customersForEmployee]);

  const handleCustomerChange = (id: string) => {
    setCustomerId(id);
    const ids = [...(deploymentLinks.customerToEmployees.get(String(id)) || new Set<number>())];
    const current = Number(form.getValues("employeeId"));
    if (current === ALL_EMPLOYEES_ID) return;
    if (!current || !ids.includes(current)) {
      form.setValue("employeeId", ids.length === 1 ? ids[0] : (undefined as unknown as number), {
        shouldDirty: true,
        shouldValidate: ids.length === 1,
      });
    }
  };

  const savePayrollConfigMutation = useMutation({
    mutationFn: async (data: PayrollConfigFormData) => {
      const creatingForEveryone = !editData?.id && Number(data.employeeId) === ALL_EMPLOYEES_ID;
      const resolvedAge =
        Number(data.age) ||
        (data.dateOfBirth ? calculateAge(new Date(data.dateOfBirth)) : 0) ||
        (selectedEmployee?.dateOfBirth
          ? calculateAge(new Date(selectedEmployee.dateOfBirth))
          : 0);
      if (!creatingForEveryone && (!resolvedAge || resolvedAge < 16)) {
        throw new Error("Selected employee must have a valid date of birth (age 16+).");
      }
      const extraAllowances: Record<string, number> = {};
      const extraDeductions: Record<string, number> = {};
      for (const item of earningCatalog) {
        if (!RESERVED_EARNING_IDS.has(item.id) || SEPARATE_EARNING_IDS.has(item.id)) {
          extraAllowances[item.id] = Number(customEarningAmounts[item.id]) || 0;
        }
      }
      for (const item of deductionCatalog) {
        if (!RESERVED_DEDUCTION_IDS.has(item.id)) {
          extraDeductions[item.id] = Number(customDeductionAmounts[item.id]) || 0;
        }
      }
      const monthDays = selectedPayrollMonth != null ? getDaysInMonth(selectedPayrollMonth) : null;
      const earningIds = earningCatalog.map((item) => item.id);
      const deductionIds = deductionCatalog.map((item) => item.id);
      if (isHourlyEmployee && (!perHourCharge || !hourlyWorkingDays)) {
        throw new Error("Select the month. Salary is the employee's per hour charge times that month's working days.");
      }
      const payrollData: PayrollConfigFormData = isHourlyEmployee
        ? {
            ...data,
            baseSalary: normalPay > 0 ? normalPay : data.baseSalary,
            hourlyRate: undefined,
            overtimeRate: undefined,
          }
        : data;
      const selectedCustomer = customers.find((customer) => String(customer.id) === customerId);

      const withHourlyDetails = (
        payload: Record<string, any>,
        hourly?: { rate: number; days: number; normalHours: number; actualHours: number; pay: number; otHours: number; otRate: number; otPay: number },
      ) => {
        const useHourly = hourly != null || isHourlyEmployee;
        if (!useHourly && !selectedCustomer) return payload;
        const allowances = { ...(payload.allowances || {}) };
        if (useHourly) {
          allowances.perHourCharge = hourly?.rate ?? perHourCharge;
          allowances.normalWorkingDays = hourly?.days ?? hourlyWorkingDays;
          allowances.hourlyNormalRate = hourly?.rate ?? perHourCharge;
          allowances.hourlyNormalHours = hourly?.normalHours ?? normalWorkingHours;
          allowances.hourlyActualHours = hourly?.actualHours ?? actualWorkingHours;
          allowances.hourlyNormalPay = hourly?.pay ?? normalPay;
          allowances.overtime = hourly?.otPay ?? hourlyOtPay;
        }
        if (selectedCustomer) {
          allowances.assignedCustomerId = Number(selectedCustomer.id);
          allowances.assignedCustomerName = selectedCustomer.name;
        }
        const selectedTsCustomer = timesheetCustomers.find(
          (row) => String(row.partyId || row.customerName) === selectedCustomerPartyKey
            || String(row.partyId) === customerId,
        );
        if (selectedTsCustomer?.timesheetNos?.length) {
          allowances.timesheetReferenceNo = selectedTsCustomer.timesheetNos.join(", ");
          allowances.timesheetReferenceNos = selectedTsCustomer.timesheetNos;
        }
        return { ...payload, allowances };
      };

      if (creatingForEveryone) {
        const customerEmployeeIds = selectedCustomer
          ? (deploymentLinks.customerToEmployees.get(String(selectedCustomer.id)) || new Set<number>())
          : null;
        const targets = activeEmployees.filter((employee) => {
          if (customerEmployeeIds && !customerEmployeeIds.has(Number(employee.id))) return false;
          if (!employee.dateOfBirth) return false;
          return calculateAge(new Date(employee.dateOfBirth)) >= 16;
        });
        if (targets.length === 0) {
          throw new Error("No active employees with a valid date of birth.");
        }
        const pendingTargets = targets.filter((employee) => {
          const months = listEmployeePayrollMonths(payrollRecords, Number(employee.id));
          return !months.some(
            (row) => row.year === selectedPayrollYear && row.month === selectedPayrollMonth,
          );
        });
        if (pendingTargets.length === 0) {
          throw new Error(
            "Already month completed. This month's payroll is already created for all selected employees. Use Edit to change it.",
          );
        }
        const created = [];
        for (const employee of pendingTargets) {
          const dob = new Date(employee.dateOfBirth);
          const age = calculateAge(dob);
          const citizenship = mapNationalityToCitizenship(employee.nationality);
          const employeeHourly = String(employee.workType || "") === "hourly";
          const employeeBasic = parseFloat(employee.salary || "0") || Number(data.baseSalary) || 0;
          const employeeRate = employeeHourly ? Number(employee.perHourCharge) || 0 : 0;
          const employeeDays = employeeHourly && selectedPayrollMonth != null
            ? countWeekdays(selectedPayrollYear, selectedPayrollMonth)
            : 0;
          const employeeNormalHours = employeeHourly ? employeeDays * HOURS_PER_WORKING_DAY : 0;
          const employeeActualHours = employeeHourly ? employeeNormalHours : 0;
          const employeeNormalPay = employeeHourly ? roundMoney(employeeRate * employeeNormalHours) : 0;
          const employeeOtHours = employeeHourly ? roundMoney(Math.max(0, employeeActualHours - employeeNormalHours)) : 0;
          const employeeOtRate = employeeHourly ? roundMoney(employeeRate * 1.5) : 0;
          const employeeOtPay = employeeHourly ? roundMoney(employeeOtHours * employeeOtRate) : 0;
          const payload = withHourlyDetails({
            ...buildPayrollConfigPayload(
              {
                ...data,
                employeeId: Number(employee.id),
                age,
                dateOfBirth: toDateInputValue(dob),
                citizenshipStatus: citizenship,
                ...(employeeHourly
                  ? {
                      baseSalary: employeeNormalPay > 0 ? employeeNormalPay : employeeBasic,
                      overtimeRate: undefined,
                      hourlyRate: undefined,
                    }
                  : {}),
              },
              employee,
              citizenship,
              age,
              monthDays,
              extraAllowances,
              extraDeductions,
              earningIds,
              deductionIds,
            ),
            payrollMonth: selectedPayrollMonth,
            payrollYear: selectedPayrollYear,
          }, employeeHourly
            ? { rate: employeeRate, days: employeeDays, normalHours: employeeNormalHours, actualHours: employeeActualHours, pay: employeeNormalPay, otHours: employeeOtHours, otRate: employeeOtRate, otPay: employeeOtPay }
            : undefined);
          const res = await apiRequest("POST", "/api/employee-payroll", payload);
          created.push(await res.json());
        }
        return created;
      }

      const payload = withHourlyDetails({
        ...buildPayrollConfigPayload(
          payrollData,
          selectedEmployee,
          data.citizenshipStatus || "citizen",
          resolvedAge,
          monthDays,
          extraAllowances,
          extraDeductions,
          earningIds,
          deductionIds,
        ),
        payrollMonth: selectedPayrollMonth,
        payrollYear: selectedPayrollYear,
      });

      const res = editData?.id
        ? await apiRequest("PUT", `/api/employee-payroll/${editData.id}`, payload)
        : await apiRequest("POST", "/api/employee-payroll", payload);
      return await res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-payroll"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/configs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/records"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({
        title: "Success",
        description: editData?.id
          ? "Payroll updated successfully"
          : Array.isArray(result)
            ? `Payroll created for ${result.length} employees`
            : "Payroll created successfully",
      });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: PayrollConfigFormData) => {
    if (selectedPayrollMonth == null) {
      setMonthError("Month is required");
      return;
    }
    const monthAlreadyCreated = savedMonths.some(
      (row) => row.year === selectedPayrollYear && row.month === selectedPayrollMonth,
    );
    // Create Payroll: once a month is saved, only Edit is allowed.
    if (!editData?.id && monthAlreadyCreated) {
      setMonthError("Already month completed");
      toast({
        title: "Already month completed",
        description: "This month's payroll is already created. Use Edit to change it.",
        variant: "destructive",
      });
      return;
    }
    setMonthError("");
    savePayrollConfigMutation.mutate(data);
  };

  const commitPayheadStore = (kind: PayheadKind, next: PayheadStore) => {
    savePayheadStore(kind, next);
    if (kind === "earning") setEarningStore(next);
    else setDeductionStore(next);
  };

  const openPayheadDialog = (kind: PayheadKind, mode: "create" | "edit", item?: Payhead) => {
    setPayheadDialog({ kind, mode, id: item?.id, label: item?.label || "" });
    setPayheadName(item?.label || "");
  };

  const savePayheadName = () => {
    if (!payheadDialog) return;
    const label = payheadName.trim();
    if (!label) {
      toast({ title: "Enter a name", variant: "destructive" });
      return;
    }
    const kind = payheadDialog.kind;
    const store = kind === "earning" ? earningStore : deductionStore;
    const catalog = kind === "earning" ? earningCatalog : deductionCatalog;
    const duplicate = catalog.some(
      (item) => item.id !== payheadDialog.id && item.label.toLowerCase() === label.toLowerCase(),
    );
    if (duplicate) {
      toast({ title: "That name already exists", variant: "destructive" });
      return;
    }
    if (payheadDialog.mode === "create") {
      const reserved = kind === "earning" ? RESERVED_EARNING_IDS : RESERVED_DEDUCTION_IDS;
      let id = slugifyPayhead(label);
      let suffix = 2;
      const base = id;
      while (reserved.has(id) || store.custom.some((item) => item.id === id) || catalog.some((item) => item.id === id)) {
        id = `${base}_${suffix++}`;
      }
      commitPayheadStore(kind, { ...store, custom: [...store.custom, { id, label }] });
    } else if (payheadDialog.id) {
      commitPayheadStore(kind, {
        ...store,
        renames: { ...store.renames, [payheadDialog.id]: label },
        custom: store.custom.map((item) => (item.id === payheadDialog.id ? { ...item, label } : item)),
      });
    }
    setPayheadDialog(null);
  };

  const deletePayhead = (kind: PayheadKind, id: string) => {
    const store = kind === "earning" ? earningStore : deductionStore;
    const isCustom = store.custom.some((item) => item.id === id);
    commitPayheadStore(kind, {
      ...store,
      hidden: isCustom ? store.hidden.filter((hiddenId) => hiddenId !== id) : [...store.hidden, id],
      custom: store.custom.filter((item) => item.id !== id),
    });
    const earningField = EARNING_FORM_FIELDS[id];
    const deductionField = DEDUCTION_FORM_FIELDS[id];
    if (kind === "earning" && earningField) form.setValue(earningField, undefined);
    if (kind === "deduction" && deductionField) form.setValue(deductionField, undefined);
    if (kind === "earning" && !earningField) {
      setCustomEarningAmounts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
    if (kind === "deduction" && !deductionField) {
      setCustomDeductionAmounts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  };

  const hasPayrollPreview = Boolean(baseSalary && age);

  const allowancesTotal = calculationPreview?.allowancesTotal ?? 0;
  const bonusTotal = calculationPreview?.bonusTotal ?? 0;
  const otherIncomeTotal = calculationPreview?.otherIncomeTotal ?? 0;
  const deductionsTotal = calculationPreview?.deductionsTotal ?? 0;
  const grossSalary =
    calculationPreview?.grossPay ??
    (hasPayrollPreview ? basicSalaryForCpf + allowancesTotal + bonusTotal + otherIncomeTotal + overtimePay : 0);
  const employeeCpf = calculationPreview?.employeeCpf ?? 0;
  const employerCpf = calculationPreview?.employerCpf ?? 0;
  const totalCpf = calculationPreview?.totalCpf ?? 0;
  const employeeCpfRate = calculationPreview?.employeeRate ?? 0;
  const employerCpfRate = calculationPreview?.employerRate ?? 0;
  const netSalary =
    calculationPreview?.netPay ??
    (hasPayrollPreview ? baseSalary + allowancesTotal + bonusTotal + otherIncomeTotal + overtimePay - deductionsTotal - employeeCpf : 0);

  return (
    <TooltipProvider>
      <div className="w-full">
        <Form {...form}>
          <form
            onSubmit={(event) => {
              if (selectedPayrollMonth == null) setMonthError("Month is required");
              form.handleSubmit(onSubmit)(event);
            }}
            className="space-y-8"
          >
            <section className="space-y-4">
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                <FormField
                  control={form.control}
                  name="employeeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={formLabelClass}>Employee *</FormLabel>
                      {isEditMode ? (
                        <FormControl>
                          <Input
                            readOnly
                            value={
                              selectedEmployee
                                ? `${selectedEmployee.name} (${selectedEmployee.employeeId}) - ${selectedEmployee.designation}`
                                : editData?.employeeName
                                  ? `${editData.employeeName} - ${editData.designation ?? ""}`
                                  : "Selected employee"
                            }
                            className={readOnlyInputClass}
                          />
                        </FormControl>
                      ) : (
                        <FormControl>
                          <EmployeeCombobox
                            employees={visibleEmployeeOptions}
                            value={field.value}
                            onChange={(id) => field.onChange(id)}
                            disabled={employeesLoading}
                            loading={employeesLoading}
                            placeholder="Select employee or All Employees"
                            searchPlaceholder="Search employee..."
                          />
                        </FormControl>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormItem>
                  <FormLabel className={formLabelClass}>Month *</FormLabel>
                  <Popover open={monthMenuOpen} onOpenChange={setMonthMenuOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:border-[#2563EB] focus-visible:border-[#2563EB] focus-visible:ring-1 focus-visible:ring-[#2563EB] focus-visible:ring-offset-0 data-[state=open]:border-[#2563EB] data-[state=open]:ring-1 data-[state=open]:ring-[#2563EB]"
                      >
                        <span className={selectedPayrollMonth == null ? "text-muted-foreground" : "text-[#111827]"}>
                          {selectedMonthLabel}
                        </span>
                        <ChevronDown className="h-4 w-4 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-2"
                    >
                      <div className="grid grid-cols-3 gap-2">
                        {payrollMonthChoices.map((month) => {
                          const selected = selectedPayrollMonth === month.month && selectedPayrollYear === month.year;
                          const done = savedMonths.some((row) => row.year === month.year && row.month === month.month);
                          return (
                            <button
                              key={`${month.year}-${month.month}`}
                              type="button"
                              disabled={!month.enabled}
                              className={cn(
                                "relative rounded-md border px-2 py-2 text-center text-xs text-[#111827]",
                                month.enabled
                                  ? "border-[#BFDBFE] bg-white hover:bg-[#EFF6FF]"
                                  : "cursor-not-allowed border-[#E5E7EB] bg-[#F3F4F6] text-[#9CA3AF]",
                                selected && "border-[#2563EB] bg-[#EFF6FF] font-medium text-[#1D4ED8]",
                              )}
                              onClick={() => {
                                if (!month.enabled) return;
                                applyMonthSelection(month.month, month.year);
                              }}
                            >
                              {month.label}
                              {done ? (
                                <Check className="absolute right-1 top-1 h-3.5 w-3.5 text-[#16A34A]" />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                  {monthError ? <p className="text-sm font-medium text-destructive">{monthError}</p> : null}
                </FormItem>
              </div>

              {selectedEmployee && !isAllEmployees && selectedPayrollMonth != null && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-[#111827]">
                    Customers — click a customer to load per-hour / working days
                  </p>
                  {timesheetCustomers.length === 0 ? (
                    <div className="rounded-md border border-dashed border-[#E5E7EB] px-3 py-4 text-sm text-[#6B7280]">
                      No customer timesheets found for this employee in the selected month.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-md border border-[#E5E7EB]">
                      <table className="min-w-full text-sm">
                        <thead className="bg-[#EFF6FF] text-left text-[#1D4ED8]">
                          <tr>
                            {["#", "Customer", "Working Days", "Normal Hrs", "OT Hrs", "Total Hrs"].map((heading) => (
                              <th key={heading} className="whitespace-nowrap px-3 py-2 font-medium">{heading}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {timesheetCustomers.map((row, index) => {
                            const partyKey = String(row.partyId || row.customerName || "");
                            const selected = selectedCustomerPartyKey === partyKey || String(row.partyId) === customerId;
                            const ot = Math.round((row.ot15 + row.ot20 + row.restDay + row.publicHoliday) * 100) / 100;
                            return (
                              <tr
                                key={partyKey || `customer-${index}`}
                                className={cn(
                                  "cursor-pointer border-t border-[#E5E7EB] hover:bg-[#F8FAFC]",
                                  selected && "bg-[#EFF6FF]",
                                )}
                                onClick={() => applyCustomerHoursRow(row)}
                              >
                                <td className="whitespace-nowrap px-3 py-2 font-medium text-[#111827]">
                                  Customer {index + 1}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 font-medium text-[#111827]">{row.customerName}</td>
                                <td className="px-3 py-2">{row.workingDays || 0}</td>
                                <td className="px-3 py-2">{row.normal.toFixed(2)}</td>
                                <td className="px-3 py-2">{ot.toFixed(2)}</td>
                                <td className="px-3 py-2">{row.totalHours.toFixed(2)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {selectedEmployee && (
                <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] p-5">
                    <div className="grid grid-cols-1 content-start gap-x-8 gap-y-5 sm:grid-cols-2">
                      <InfoItem label="Employee ID" value={selectedEmployee.employeeId || "-"} />
                      <InfoItem label="Employee Name" value={selectedEmployee.name || "-"} />
                      <InfoItem label="Department" value={selectedEmployee.department || "-"} />
                      <InfoItem label="Designation" value={selectedEmployee.designation || "-"} />
                      {!isHourlyEmployee ? (
                        <>
                          <InfoItem
                            label="Basic Salary"
                            value={formatCurrency(parseFloat(selectedEmployee.salary || "0"))}
                          />
                          <InfoItem
                            label="Annual Salary"
                            value={formatCurrency(
                              parseFloat(selectedEmployee.annualSalary || "0") ||
                                (parseFloat(selectedEmployee.salary || "0") || 0) * 12
                            )}
                          />
                        </>
                      ) : null}
                      <InfoItem label="Nationality" value={formatNationalityDisplay(selectedEmployee)} />
                      <InfoItem label="PR Status" value={formatPrStatusDisplay(selectedEmployee.prStatus)} />
                      <InfoItem
                        label="Date of Birth"
                        value={formatDisplayDate(selectedEmployee.dateOfBirth)}
                      />
                      <InfoItem
                        label="Age"
                        value={
                          selectedEmployee.dateOfBirth
                            ? String(calculateAge(new Date(selectedEmployee.dateOfBirth)))
                            : String(form.watch("age") || "-")
                        }
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-4">
                    <h3 className="mb-2 flex items-center gap-2 text-base font-semibold text-[#111827]">
                      <Calculator className="h-4 w-4 text-[#2563EB]" />
                      CPF Preview
                    </h3>
                    <div className="space-y-1.5 text-sm">
                      {isHourlyEmployee ? (
                        <>
                          {/* Hourly: compact preview (Basic → Gross → CPF → Net) */}
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">Basic Salary</span>
                            <span className="font-medium text-[#111827]">
                              {formatCurrency(normalPay)}
                            </span>
                          </div>
                          <div className="flex justify-between border-t border-[#E5E7EB] pt-1.5">
                            <span className="font-semibold text-[#111827]">Gross Salary</span>
                            <span className="font-semibold text-[#111827]">{formatCurrency(grossSalary)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">CPF Rate (Employee)</span>
                            <span className="text-[#111827]">{formatRatePercent(employeeCpfRate)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">CPF Amount (Employee)</span>
                            <span className="font-medium text-[#DC2626]">-{formatCurrency(employeeCpf)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">CPF Rate (Employer)</span>
                            <span className="text-[#111827]">{formatRatePercent(employerCpfRate)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">CPF Amount (Employer)</span>
                            <span className="text-[#111827]">{formatCurrency(employerCpf)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">Total CPF</span>
                            <span className="text-[#111827]">{formatCurrency(totalCpf)}</span>
                          </div>
                          <div className="flex justify-between border-t border-[#E5E7EB] pt-1.5">
                            <span className="text-base font-semibold text-[#111827]">Net Salary</span>
                            <span className="text-lg font-bold text-[#16A34A]">{formatCurrency(netSalary)}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Monthly: full salary breakdown */}
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">Basic Salary</span>
                            <span className="font-medium text-[#111827]">
                              {formatCurrency(baseSalary)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">Basic salary for CPF</span>
                            <span className="font-medium text-[#111827]">
                              {formatCurrency(basicSalaryForCpf)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">Allowances</span>
                            <span className="font-medium text-[#111827]">
                              {formatCurrency(allowancesTotal)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">Bonus</span>
                            <span className="font-medium text-[#111827]">
                              {formatCurrency(bonusTotal)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">Other Income / Benefits</span>
                            <span className="font-medium text-[#111827]">
                              {formatCurrency(otherIncomeTotal)}
                            </span>
                          </div>
                          {overtimePay > 0 ? (
                            <div className="flex justify-between">
                              <span className="text-[#6B7280]">Overtime</span>
                              <span className="font-medium text-[#111827]">{formatCurrency(overtimePay)}</span>
                            </div>
                          ) : null}
                          <div className="flex justify-between border-t border-[#E5E7EB] pt-1.5">
                            <span className="font-semibold text-[#111827]">Gross Salary</span>
                            <span className="font-semibold text-[#111827]">{formatCurrency(grossSalary)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">Deductions</span>
                            <span className="font-medium text-[#DC2626]">
                              -{formatCurrency(deductionsTotal)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">CPF Rate (Employee)</span>
                            <span className="text-[#111827]">{formatRatePercent(employeeCpfRate)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">CPF Amount (Employee)</span>
                            <span className="font-medium text-[#DC2626]">-{formatCurrency(employeeCpf)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">CPF Rate (Employer)</span>
                            <span className="text-[#111827]">{formatRatePercent(employerCpfRate)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">CPF Amount (Employer)</span>
                            <span className="text-[#111827]">{formatCurrency(employerCpf)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">Total CPF</span>
                            <span className="text-[#111827]">{formatCurrency(totalCpf)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#6B7280]">Total Deductions</span>
                            <span className="font-medium text-[#DC2626]">
                              -{formatCurrency(deductionsTotal + employeeCpf)}
                            </span>
                          </div>
                          <div className="flex justify-between border-t border-[#E5E7EB] pt-1.5">
                            <span className="text-base font-semibold text-[#111827]">Net Salary</span>
                            <span className="text-lg font-bold text-[#16A34A]">{formatCurrency(netSalary)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {isHourlyEmployee && (
              <section className="space-y-4 rounded-lg border border-[#E5E7EB] bg-white p-4">
                <h3 className="text-lg font-semibold text-[#111827]">Per hour</h3>
                <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-4">
                  <div className="space-y-1.5">
                    <label className={payheadLabelClass}>Per hour cost</label>
                    <Input readOnly value={perHourCharge > 0 ? perHourCharge.toFixed(2) : ""} className={readOnlyInputClass} />
                    <p className="text-xs text-[#6B7280]">From the employee per hour charge</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className={payheadLabelClass}>Working days</label>
                    <Input
                      readOnly
                      value={selectedPayrollMonth == null ? "" : String(hourlyWorkingDays)}
                      className={readOnlyInputClass}
                    />
                    <p className="text-xs text-[#6B7280]">From selected customer timesheet (or weekdays in month)</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className={payheadLabelClass}>Normal Working Hours</label>
                    <Input
                      readOnly
                      value={selectedPayrollMonth == null ? "" : String(normalWorkingHours)}
                      className={readOnlyInputClass}
                    />
                    <p className="text-xs text-[#6B7280]">
                      {normalHours !== "" ? "From timesheet normal hours" : hourlyWorkingDays > 0 ? `${hourlyWorkingDays} working days × ${HOURS_PER_WORKING_DAY} hours` : "Select a month"}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className={payheadLabelClass}>Actual Working Hours</label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={selectedPayrollMonth == null ? "" : (actualHours === "" ? String(autoNormalHours) : actualHours)}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === "" || /^\d*\.?\d*$/.test(value)) setActualHours(value);
                      }}
                    />
                    <p className="text-xs text-[#6B7280]">Hours above normal working hours are overtime</p>
                  </div>
                </div>
                <div className="space-y-2 border-t border-[#E5E7EB] pt-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#111827]">Normal Pay</span>
                    <span className="font-medium text-[#111827]">{formatCurrency(normalPay)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#111827]">OT Hours</span>
                    <span className="font-medium text-[#111827]">{hourlyOtHours.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#111827]">OT Rate (1.5×)</span>
                    <span className="font-medium text-[#111827]">{formatCurrency(hourlyOtRate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#111827]">OT Pay</span>
                    <span className="font-medium text-[#111827]">{formatCurrency(hourlyOtPay)}</span>
                  </div>
                </div>
              </section>
            )}

            {!isHourlyEmployee && (
            <section className="space-y-4">
              <div className="mb-1">
                <h3 className="text-lg font-semibold text-[#111827]">Payheads</h3>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="inline-flex items-center rounded-md bg-[#EFF6FF] px-3 py-1.5 text-lg font-bold tracking-wide text-[#1D4ED8]">
                    Earnings
                  </h4>
                  <PayheadMenu
                    buttonLabel="Add earnings"
                    buttonClassName="border-[#BFDBFE] text-[#1D4ED8] hover:bg-[#EFF6FF]"
                    items={earningCatalog}
                    onCreate={() => openPayheadDialog("earning", "create")}
                    onEdit={(item) => openPayheadDialog("earning", "edit", item)}
                    onDelete={(item) => deletePayhead("earning", item.id)}
                  />
                </div>
                <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="baseSalary"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={payheadLabelClass}>Basic Salary *</FormLabel>
                        <FormControl>
                          <div className="relative">
                            {selectedEmployee && (
                              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[#6B7280]">
                                <DollarSign className="h-4 w-4" />
                              </span>
                            )}
                            <Input
                              type="text"
                              inputMode="decimal"
                              placeholder=""
                              className={selectedEmployee ? "pl-9" : undefined}
                              value={field.value ?? ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v !== "" && !/^\d*\.?\d*$/.test(v)) return;
                                field.onChange(v === "" ? undefined : Number(v));
                              }}
                              onBlur={field.onBlur}
                              name={field.name}
                              ref={field.ref}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="payrollPeriod"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={payheadLabelClass}>Payroll Period *</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="monthly">Monthly</SelectItem>
                            <SelectItem value="bi_weekly">Bi-weekly</SelectItem>
                            <SelectItem value="weekly">Weekly</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="workingDays"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={payheadLabelClass}>No of Working Days</FormLabel>
                        <FormControl>
                          <Input
                            type="text"
                            inputMode="numeric"
                            placeholder=""
                            value={field.value ?? ""}
                            onChange={(e) => {
                              const v = e.target.value.replace(/\D/g, "");
                              field.onChange(v === "" ? undefined : parseInt(v, 10));
                            }}
                            onBlur={field.onBlur}
                            name={field.name}
                            ref={field.ref}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {!isHourlyEmployee && (
                    <>
                  <FormField
                    control={form.control}
                    name="overtimeRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={payheadLabelClass}>Overtime Hours</FormLabel>
                        <FormControl>
                          <OptionalAmountInput field={field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="hourlyRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={payheadLabelClass}>Overtime pay (SGD)</FormLabel>
                        <FormControl>
                          <OptionalAmountInput field={field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                    </>
                  )}
                  {earningCatalog.length > 0 && (
                    <div className="col-span-full grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {earningCatalog.map((item) => {
                        const fieldName = EARNING_FORM_FIELDS[item.id];
                        const fieldBody = fieldName ? (
                          <FormField
                            key={item.id}
                            control={form.control}
                            name={fieldName}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className={payheadLabelClass}>{item.label}</FormLabel>
                                <FormControl>
                                  <OptionalAmountInput field={field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        ) : (
                          <FormItem key={item.id}>
                            <FormLabel className={payheadLabelClass}>{item.label}</FormLabel>
                            <OptionalAmountInput
                              field={{
                                name: item.id,
                                value: customEarningAmounts[item.id],
                                onChange: (value) =>
                                  setCustomEarningAmounts((current) => ({ ...current, [item.id]: value })),
                              }}
                            />
                          </FormItem>
                        );
                        return (
                          <div key={item.id} className="min-w-0">
                            {fieldBody}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="inline-flex items-center rounded-md bg-[#FEF2F2] px-3 py-1.5 text-lg font-bold tracking-wide text-[#B91C1C]">
                    Deductions
                  </h4>
                  <PayheadMenu
                    buttonLabel="Add deductions"
                    buttonClassName="border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2]"
                    items={deductionCatalog}
                    onCreate={() => openPayheadDialog("deduction", "create")}
                    onEdit={(item) => openPayheadDialog("deduction", "edit", item)}
                    onDelete={(item) => deletePayhead("deduction", item.id)}
                  />
                </div>
                <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                  {deductionCatalog.map((item) => {
                    const fieldName = DEDUCTION_FORM_FIELDS[item.id];
                    if (fieldName) {
                      return (
                        <FormField
                          key={item.id}
                          control={form.control}
                          name={fieldName}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className={payheadLabelClass}>{item.label}</FormLabel>
                              <FormControl>
                                <OptionalAmountInput field={field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      );
                    }
                    return (
                      <FormItem key={item.id}>
                        <FormLabel className={payheadLabelClass}>{item.label}</FormLabel>
                        <OptionalAmountInput
                          field={{
                            name: item.id,
                            value: customDeductionAmounts[item.id],
                            onChange: (value) =>
                              setCustomDeductionAmounts((current) => ({ ...current, [item.id]: value })),
                          }}
                        />
                      </FormItem>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <FormItem>
                  <FormLabel className={formLabelClass}>Salary for CPF</FormLabel>
                  <FormControl>
                    <Input
                      readOnly
                      placeholder=""
                      value={baseSalary ? formatCurrency(basicSalaryForCpf) : ""}
                      className={readOnlyInputClass}
                    />
                  </FormControl>
                </FormItem>
                <FormItem>
                  <FormLabel className={formLabelClass}>CPF Capped Limit</FormLabel>
                  <FormControl>
                    <Input
                      readOnly
                      placeholder=""
                      value={formatCurrency(CPF_WAGE_CEILING)}
                      className={readOnlyInputClass}
                    />
                  </FormControl>
                </FormItem>
              </div>
            </section>
            )}

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                className={payrollCancelButtonClass}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savePayrollConfigMutation.isPending}
                className={payrollPrimaryButtonClass}
              >
                {savePayrollConfigMutation.isPending
                  ? isEditMode
                    ? "Updating..."
                    : "Creating..."
                  : isEditMode
                    ? "Update Payroll"
                    : "Create Payroll"}
              </Button>
            </div>
            <Dialog open={payheadDialog != null} onOpenChange={(open) => { if (!open) setPayheadDialog(null); }}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>
                    {payheadDialog?.mode === "edit" ? "Edit payhead" : "Create new payhead"}
                  </DialogTitle>
                </DialogHeader>
                <Input
                  value={payheadName}
                  placeholder="Enter name"
                  onChange={(event) => setPayheadName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      savePayheadName();
                    }
                  }}
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setPayheadDialog(null)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={savePayheadName}>
                    Save
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </form>
        </Form>
      </div>
    </TooltipProvider>
  );
}
