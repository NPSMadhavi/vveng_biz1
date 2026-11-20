import { useState } from "react";
import { useListQuotations, useListPurchaseQuotations } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuotationRefSelectProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (qtNumber: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** sales = customer QT numbers; purchase = vendor PQ numbers */
  source?: "sales" | "purchase";
}

export function QuotationRefSelect({
  value,
  onChange,
  onSelect,
  disabled,
  placeholder = "Select quotation",
  source = "sales",
}: QuotationRefSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const salesQuery = useListQuotations({
    query: { enabled: source === "sales" },
  });
  const purchaseQuery = useListPurchaseQuotations({
    query: { enabled: source === "purchase" },
  });
  const isLoading = source === "purchase" ? purchaseQuery.isLoading : salesQuery.isLoading;
  const rows = (source === "purchase" ? purchaseQuery.data : salesQuery.data) as any[] | undefined;
  const allNumbers: string[] = (rows || [])
    .map((qt: any) => (source === "purchase" ? qt.pqNumber : qt.qtNumber))
    .filter(Boolean);
  // Filter only by active search — not by selected value — so reopening shows all quotations
  const filtered = search.trim()
    ? allNumbers.filter((n) => n.toLowerCase().includes(search.trim().toLowerCase()))
    : allNumbers;
  const headingLabel = source === "purchase" ? "Purchase Quotation" : "Quotation";

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
                {isLoading ? `Loading ${headingLabel.toLowerCase()}s…` : `No ${headingLabel.toLowerCase()}s found`}
              </CommandEmpty>
            ) : (
              <CommandGroup heading={`${allNumbers.length} ${headingLabel}${allNumbers.length !== 1 ? "s" : ""}`}>
                {filtered.map((qn) => (
                  <CommandItem
                    key={qn}
                    value={qn}
                    onSelect={() => {
                      onChange(qn);
                      onSelect?.(qn);
                      setSearch("");
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-3.5 w-3.5 shrink-0", value === qn ? "opacity-100" : "opacity-0")} />
                    <span className="font-mono text-sm">{qn}</span>
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
