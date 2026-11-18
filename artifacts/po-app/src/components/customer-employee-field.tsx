import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type EmployeeRow = {
  id: number;
  employeeId?: string | number | null;
  name?: string | null;
};

async function fetchEmployees(): Promise<EmployeeRow[]> {
  const res = await fetch("/api/employees", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load employees");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export function CustomerEmployeeField({
  employeeIds,
  onChange,
  customerId,
}: {
  employeeIds: number[];
  onChange: (ids: number[]) => void;
  customerId?: number;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    document.body.setAttribute("data-employee-picker-open", "true");
    return () => document.body.removeAttribute("data-employee-picker-open");
  }, [open]);

  const { data: employees = [], isLoading, isError } = useQuery({
    queryKey: ["customer-assign-employees"],
    queryFn: fetchEmployees,
  });

  const rows = useMemo(
    () =>
      [...employees].sort((a, b) =>
        String(a.employeeId ?? "").localeCompare(String(b.employeeId ?? ""), undefined, { numeric: true }),
      ),
    [employees],
  );

  const selectedNames = rows
    .filter((employee) => employeeIds.includes(Number(employee.id)))
    .map((employee) => employee.name || String(employee.employeeId ?? employee.id));

  const summary = selectedNames.length > 0
    ? selectedNames.join(", ")
    : employeeIds.length > 0
      ? `${employeeIds.length} employee${employeeIds.length === 1 ? "" : "s"} selected`
      : "";

  function openPicker() {
    setDraft(employeeIds);
    setOpen(true);
  }

  function toggle(id: number) {
    setDraft((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  async function assign() {
    if (draft.length === 0) {
      toast({ title: "Select employees", description: "Choose at least one employee." });
      return;
    }
    if (customerId) {
      setSaving(true);
      try {
        const res = await fetch(`/api/customers/${customerId}/employees`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ employeeIds: draft }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Failed to assign employees");
        }
        await queryClient.invalidateQueries({ queryKey: ["customers"] });
      } catch (error) {
        toast({
          title: "Could not assign",
          description: error instanceof Error ? error.message : "Failed to assign employees",
          variant: "destructive",
        });
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    onChange(draft);
    setOpen(false);
    toast({
      title: "Assigned to customer",
      description: customerId
        ? `${draft.length} employee${draft.length === 1 ? "" : "s"} assigned to this customer.`
        : `${draft.length} employee${draft.length === 1 ? "" : "s"} selected. They are saved when you create the customer.`,
    });
  }

  return (
    <div className="space-y-1.5">
      <Label>Assigned customer</Label>
      <button
        type="button"
        onClick={openPicker}
        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-left text-sm"
      >
        <span className={summary ? "truncate text-foreground" : "truncate text-muted-foreground"}>
          {summary || "Select employees"}
        </span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          data-employee-picker=""
          className="z-[80] flex max-h-[80vh] max-w-lg flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>Assigned customer</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr className="border-b text-left">
                  <th className="w-12 px-3 py-2" />
                  <th className="px-3 py-2 font-medium">Employee ID</th>
                  <th className="px-3 py-2 font-medium">Employee Name</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                      Loading employees…
                    </td>
                  </tr>
                ) : isError ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-destructive">
                      Could not load employees.
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                      No employees found.
                    </td>
                  </tr>
                ) : (
                  rows.map((employee) => {
                    const id = Number(employee.id);
                    const checked = draft.includes(id);
                    return (
                      <tr
                        key={id}
                        className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                        onClick={() => toggle(id)}
                      >
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggle(id)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Select ${employee.name || "employee"}`}
                          />
                        </td>
                        <td className="px-3 py-2">{employee.employeeId || "—"}</td>
                        <td className="px-3 py-2">{employee.name || "—"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={assign} disabled={draft.length === 0 || saving}>
              {saving ? "Assigning…" : "Assigned to Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
