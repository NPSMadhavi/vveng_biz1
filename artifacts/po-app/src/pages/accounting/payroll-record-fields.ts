type PayrollRow = Record<string, unknown> | null | undefined;

export function payrollValue(row: PayrollRow, ...keys: string[]) {
  if (!row) return undefined;
  for (const key of keys) {
    const value = row[key];
    if (value != null && value !== "") return value;
  }
  return undefined;
}

export function payrollAmount(row: PayrollRow, ...keys: string[]) {
  const n = parseFloat(String(payrollValue(row, ...keys) ?? 0));
  return Number.isFinite(n) ? n : 0;
}

export function payrollEmployeeId(row: PayrollRow) {
  return payrollValue(row, "employeeId", "employee_id");
}

export function payrollEmployeeName(row: PayrollRow, employees: any[] = []) {
  const id = payrollEmployeeId(row);
  const emp = employees.find((e) => Number(e.id) === Number(id));
  const name = payrollValue(row, "employeeName", "employee_name") || emp?.name;
  if (name) return String(name);
  return id != null ? `Employee ${id}` : "Employee";
}

export function payrollEmployeeSubtitle(row: PayrollRow, employees: any[] = []) {
  const id = payrollEmployeeId(row);
  const emp = employees.find((e) => Number(e.id) === Number(id));
  return String(emp?.employeeId || payrollValue(row, "designation") || emp?.designation || "");
}

export function payrollPeriodLabel(row: PayrollRow) {
  const start = payrollValue(row, "payPeriodStart", "pay_period_start");
  if (!start) return "—";
  const d = new Date(String(start));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-SG", { month: "short", year: "numeric" });
}

export function payrollMonthKey(row: PayrollRow) {
  const start = String(payrollValue(row, "payPeriodStart", "pay_period_start") ?? "");
  const match = start.match(/^(\d{4})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}`;
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function expenseNotes(expense: any) {
  return String(expense?.notes ?? "");
}

export function payrollPaidAmount(
  expenses: any[],
  employeeId: unknown,
  monthKey: string,
  kind: "salary" | "cpf",
) {
  if (!monthKey || employeeId == null || employeeId === "") return 0;
  const id = String(employeeId);
  return expenses.reduce((sum, expense) => {
    const notes = expenseNotes(expense);
    const description = String(expense?.description ?? "").toLowerCase();
    if (kind === "cpf") {
      const marked = notes.includes(`payroll-payment:cpf:${id}:${monthKey}`);
      const legacy =
        notes.includes(`payroll-payment:${id}:${monthKey}`) &&
        (notes.includes("Type: CPF") || notes.includes("payment-type:cpf") || notes.toLowerCase().includes("payment type: cpf") || description.includes("cpf"));
      return marked || legacy ? sum + (Number(expense.amount) || 0) : sum;
    }
    const marked = notes.includes(`payroll-payment:salary:${id}:${monthKey}`);
    const legacy =
      notes.includes(`payroll-payment:${id}:${monthKey}`) &&
      !notes.includes("payroll-payment:cpf:") &&
      !notes.includes("Type: CPF") &&
      !notes.includes("payment-type:cpf") &&
      !notes.toLowerCase().includes("payment type: cpf") &&
      !description.includes("cpf");
    return marked || legacy ? sum + (Number(expense.amount) || 0) : sum;
  }, 0);
}

export function payrollPaymentStatus(
  row: PayrollRow,
  expenses: any[],
  kind: "salary" | "cpf",
): "Paid" | "Partial" | "Pending" {
  const paid = payrollPaidAmount(expenses, payrollEmployeeId(row), payrollMonthKey(row), kind);
  const due = kind === "cpf"
    ? payrollAmount(row, "cpfDeduction", "cpfEmployee", "cpf_employee") + payrollAmount(row, "cpfEmployer", "cpf_employer")
    : payrollAmount(row, "netPay", "net_pay");
  if (due > 0 && paid + 0.009 >= due) return "Paid";
  if (paid > 0.009) return "Partial";
  return "Pending";
}
