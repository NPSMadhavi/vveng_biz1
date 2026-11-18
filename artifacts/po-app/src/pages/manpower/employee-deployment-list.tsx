import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Eye, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/auth-context";
import {
  formatDisplayDate,
  loadDeployments,
  type DeploymentSide,
} from "./deployment-store";

export function CustomerDeploymentList() {
  return <EmployeeDeploymentList side="customer" />;
}

export function SupplierDeploymentList() {
  return <EmployeeDeploymentList side="supplier" />;
}

export default function EmployeeDeploymentList({ side }: { side: DeploymentSide }) {
  const [, setLocation] = useLocation();
  const { selectedCompany } = useAuth();
  const [rows] = useState(() => loadDeployments());
  const companyId = selectedCompany?.id ?? null;
  const partyLabel = side === "customer" ? "Customer" : "Vendor";
  const base = side === "customer"
    ? "/manpower/customers/employee-deployment"
    : "/manpower/suppliers/employee-deployment";

  const visible = useMemo(
    () => rows.filter((row) => row.side === side && row.companyId === companyId),
    [rows, side, companyId],
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#2563EB]">Employee Deployment</h1>
        </div>
        <Link href={`${base}/new`}>
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Create Employee Deployment
          </Button>
        </Link>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Deployment No.</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>{partyLabel}</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Shift</TableHead>
              <TableHead className="w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  No deployments yet. Create Employee Deployment to add one.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => setLocation(`${base}/${row.id}`)}
                >
                  <TableCell className="font-medium">{row.deploymentNo}</TableCell>
                  <TableCell>{formatDisplayDate(row.deploymentDate)}</TableCell>
                  <TableCell>{row.partyName}</TableCell>
                  <TableCell>{row.employeeLabel}</TableCell>
                  <TableCell>{row.workLocation || "—"}</TableCell>
                  <TableCell>
                    {formatDisplayDate(row.startDate)} – {formatDisplayDate(row.endDate)}
                  </TableCell>
                  <TableCell>{row.workShift}</TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="View"
                        aria-label="View deployment"
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
                        aria-label="Edit deployment"
                        onClick={() => setLocation(`${base}/${row.id}/edit`)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
