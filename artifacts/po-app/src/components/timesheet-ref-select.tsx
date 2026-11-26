import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { loadTimesheets, type Timesheet } from "@/pages/manpower/timesheet-store";

interface TimesheetRefSelectProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (timesheetNo: string, sheet: Timesheet) => void;
  disabled?: boolean;
  placeholder?: string;
  side?: "customer" | "supplier";
}

export function TimesheetRefSelect({
  value,
  onChange,
  onSelect,
  disabled,
  placeholder = "Select timesheet reference",
  side = "customer",
}: TimesheetRefSelectProps) {
  const { selectedCompany } = useAuth();
  const companyId = selectedCompany?.id ?? null;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [tick, setTick] = useState(0);

  const sheets = useMemo(() => {
    void tick;
    return loadTimesheets()
      .filter((row) => row.side === side && row.companyId === companyId && String(row.timesheetNo || "").trim())
      .sort((a, b) => String(b.timesheetNo).localeCompare(String(a.timesheetNo)));
  }, [side, companyId, tick]);

  const filtered = search.trim()
    ? sheets.filter((row) => {
        const q = search.trim().toLowerCase();
        return (
          String(row.timesheetNo).toLowerCase().includes(q) ||
          String(row.partyName || "").toLowerCase().includes(q) ||
          String(row.poReference || "").toLowerCase().includes(q)
        );
      })
    : sheets;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSearch("");
          setTick((n) => n + 1);
        }
      }}
    >
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            placeholder={placeholder}
            value={open ? search : value}
            disabled={disabled}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => {
              setSearch("");
              setOpen(true);
              setTick((n) => n + 1);
            }}
            className="pr-8 font-mono"
          />
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setOpen((v) => {
                if (!v) {
                  setSearch("");
                  setTick((n) => n + 1);
                }
                return !v;
              });
            }}
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        style={{ width: "var(--radix-popover-trigger-width)" }}
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandEmpty>No timesheets found.</CommandEmpty>
            <CommandGroup>
              {filtered.map((sheet) => {
                const label = sheet.timesheetNo;
                const selected = String(value).trim().toUpperCase() === String(label).trim().toUpperCase();
                return (
                  <CommandItem
                    key={sheet.id}
                    value={label}
                    onSelect={() => {
                      onChange(label);
                      onSelect?.(label, sheet);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
                    <div className="min-w-0">
                      <div className="font-mono text-sm">{label}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[sheet.partyName, sheet.poReference].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
