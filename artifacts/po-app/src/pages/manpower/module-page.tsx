import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";

const MODULES: Record<string, { title: string; group: string }> = {
  "/manpower/suppliers/quotations": { title: "Quotation", group: "Vendors" },
  "/manpower/suppliers/purchase-orders": { title: "Purchase order", group: "Vendors" },
  "/manpower/suppliers/timesheets": { title: "Time Sheet Management", group: "Vendors" },
  "/manpower/suppliers/vendor-invoices": { title: "Vendor Invoice", group: "Vendors" },
  "/manpower/customers/quotations": { title: "Quotation", group: "Customer" },
  "/manpower/customers/sales-orders": { title: "Sales order", group: "Customer" },
  "/manpower/customers/timesheets": { title: "Time Sheet Management", group: "Customer" },
  "/manpower/customers/tax-invoices": { title: "Tax Invoice", group: "Customer" },
};

export default function ManpowerModulePage() {
  const [location] = useLocation();
  const path = location.split("?")[0];
  const page = MODULES[path] ?? { title: "Man power supply", group: "Man power supply" };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">{page.group}</p>
        <h1 className="text-2xl font-bold tracking-tight text-[#2563EB]">{page.title}</h1>
      </div>
      <Card className="flex min-h-[240px] items-center justify-center p-10 text-sm text-muted-foreground">
        No records yet.
      </Card>
    </div>
  );
}
