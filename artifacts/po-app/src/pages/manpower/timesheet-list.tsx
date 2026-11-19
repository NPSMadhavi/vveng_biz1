import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Eye, FileBarChart, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/auth-context";
import { formatDisplayDate, type DeploymentSide } from "./deployment-store";
import { loadTimesheets, type Timesheet } from "./timesheet-store";

function statusBadge(status: Timesheet["status"]) {
  if (status === "approved") return <Badge className="bg-emerald-600 hover:bg-emerald-700">Confirmed</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  if (status === "submitted") return <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">Pending</Badge>;
  return <Badge variant="secondary">Draft</Badge>;
}

export function CustomerTimesheetList() {
  return <TimesheetList side="customer" />;
}

export function SupplierTimesheetList() {
  return <TimesheetList side="supplier" />;
}

export default function TimesheetList({ side }: { side: DeploymentSide }) {
  const [, setLocation] = useLocation();
  const { selectedCompany } = useAuth();
  const [rows] = useState(() => loadTimesheets());
  const companyId = selectedCompany?.id ?? null;
  const partyLabel = side === "customer" ? "Customer" : "Vendor";
  const base = side === "customer" ? "/manpower/customers/timesheets" : "/manpower/suppliers/timesheets";
  const visible = useMemo(
    () => rows.filter((row) => row.side === side && row.companyId === companyId),
    [rows, side, companyId],
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#2563EB]">Time Sheet Management</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`${base}/report`}>
            <Button className="gap-2 bg-[#2563EB] text-white hover:bg-[#1D4ED8]"><FileBarChart className="h-4 w-4" />Report</Button>
          </Link>
          <Link href={`${base}/new`}>
            <Button className="gap-2"><Plus className="h-4 w-4" />New Timesheet</Button>
          </Link>
        </div>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timesheet No.</TableHead>
              <TableHead>Work Date</TableHead>
              <TableHead>Deployment No.</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>{partyLabel}</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  No timesheets yet.
                </TableCell>
              </TableRow>
            ) : visible.map((row) => (
              <TableRow key={row.id} className="cursor-pointer" onClick={() => setLocation(`${base}/${row.id}`)}>
                <TableCell className="font-medium">{row.timesheetNo}</TableCell>
                <TableCell>{formatDisplayDate(row.workDate)}</TableCell>
                <TableCell>{row.deploymentNo || "—"}</TableCell>
                <TableCell>{row.employeeLabel}</TableCell>
                <TableCell>{row.partyName || "—"}</TableCell>
                <TableCell>{statusBadge(row.status)}</TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="View"
                      aria-label="View timesheet"
                      onClick={() => setLocation(`${base}/${row.id}`)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Edit"
                      aria-label="Edit timesheet"
                      onClick={() => setLocation(`${base}/${row.id}/edit`)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
