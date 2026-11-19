import { useState } from "react";
import { useListSalesOrders } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SalesOrderRefSelectProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (soNumber: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function SalesOrderRefSelect({
  value,
  onChange,
  onSelect,
  disabled,
  placeholder = "Select sales order",
}: SalesOrderRefSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: salesOrders = [], isLoading } = useListSalesOrders();
  const allNumbers: string[] = (salesOrders as any[])
    .map((so: any) => so.soNumber)
    .filter(Boolean);
  // Filter only by active search — not by selected value — so reopening shows all sales orders
  const filtered = search.trim()
    ? allNumbers.filter((n) => n.toLowerCase().includes(search.trim().toLowerCase()))
    : allNumbers;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSearch("");
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
                if (!v) setSearch("");
                return !v;
              });
            }}
          >
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
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
            {filtered.length === 0 ? (
              <CommandEmpty className="py-2 text-center text-xs text-muted-foreground">
                {isLoading ? "Loading sales orders…" : "No sales orders found"}
              </CommandEmpty>
            ) : (
              <CommandGroup heading={`${allNumbers.length} Sales Order${allNumbers.length !== 1 ? "s" : ""}`}>
                {filtered.map((sn) => (
                  <CommandItem
                    key={sn}
                    value={sn}
                    onSelect={() => {
                      onChange(sn);
                      onSelect?.(sn);
                      setSearch("");
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-3.5 w-3.5 shrink-0", value === sn ? "opacity-100" : "opacity-0")} />
                    <span className="font-mono text-sm">{sn}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
