export type DeploymentSide = "customer" | "supplier";

export type DeploymentEmployee = {
  id: string;
  label: string;
  designation: string;
};

export type EmployeeDeployment = {
  id: string;
  companyId: number | null;
  side: DeploymentSide;
  deploymentNo: string;
  deploymentDate: string;
  partyId: string;
  partyName: string;
  poNumber: string;
  workLocation: string;
  employeeId: string;
  employeeLabel: string;
  employees?: DeploymentEmployee[];
  designation: string;
  startDate: string;
  endDate: string;
  workShift: string;
  billingRate: string;
  payRate: string;
};

const KEY = "bizone.manpower.employee-deployments";

export function loadDeployments(): EmployeeDeployment[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveDeployment(record: EmployeeDeployment) {
  const all = loadDeployments().filter((row) => row.id !== record.id);
  all.unshift(record);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function deploymentEmployees(row: EmployeeDeployment): DeploymentEmployee[] {
  if (Array.isArray(row.employees) && row.employees.length > 0) return row.employees;
  if (!row.employeeId) return [];
  return [{ id: row.employeeId, label: row.employeeLabel, designation: row.designation }];
}

export function removeDeployment(id: string) {
  const next = loadDeployments().filter((row) => row.id !== id);
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function nextDeploymentNo(companyId: number | null) {
  const year = new Date().getFullYear();
  const prefix = `DEP-${year}-`;
  const max = loadDeployments()
    .filter((row) => row.companyId === companyId && row.deploymentNo.startsWith(prefix))
    .reduce((highest, row) => {
      const seq = Number(row.deploymentNo.slice(prefix.length));
      return Number.isFinite(seq) ? Math.max(highest, seq) : highest;
    }, 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

export function formatDisplayDate(iso: string) {
  if (!iso) return "";
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return iso;
  return `${day}-${month}-${year}`;
}

export type ManpowerSupplierPerson = {
  id: string;
  companyId: number | null;
  name: string;
  designation: string;
};

const SUPPLIER_KEY = "bizone.manpower.supplier-people";

export function loadSupplierPeople(companyId: number | null): ManpowerSupplierPerson[] {
  try {
    const raw = localStorage.getItem(SUPPLIER_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const rows = Array.isArray(parsed) ? parsed as ManpowerSupplierPerson[] : [];
    return rows.filter((row) => row.companyId == null || companyId == null || row.companyId === companyId);
  } catch {
    return [];
  }
}

export function addSupplierPerson(companyId: number | null, name: string, designation: string): ManpowerSupplierPerson {
  const person: ManpowerSupplierPerson = {
    id: `supplier-${Date.now()}`,
    companyId,
    name: name.trim(),
    designation: designation.trim(),
  };
  const raw = localStorage.getItem(SUPPLIER_KEY);
  const parsed = raw ? JSON.parse(raw) : [];
  const rows = Array.isArray(parsed) ? parsed : [];
  rows.unshift(person);
  localStorage.setItem(SUPPLIER_KEY, JSON.stringify(rows));
  return person;
}

export function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
