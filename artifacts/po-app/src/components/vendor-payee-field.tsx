import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type VendorRow = {
  id: number;
  name: string;
  isActive?: boolean;
  currency?: string | null;
  usageType?: string | null;
};

export function VendorPayeeField({
  id,
  value,
  onChange,
  kind = "vendor",
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  kind?: "vendor" | "customer";
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const isCustomer = kind === "customer";
  const endpoint = isCustomer ? "/api/customers" : "/api/vendors";
  const noun = isCustomer ? "customer" : "vendor";

  const { data: vendors = [] } = useQuery<VendorRow[]>({
    queryKey: [endpoint],
    queryFn: async () => {
      const res = await fetch(endpoint, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const active = useMemo(
    () => vendors.filter((vendor) => vendor.isActive !== false && vendor.name?.trim()),
    [vendors],
  );

  const query = value.trim().toLowerCase();
  const matches = useMemo(() => {
    const filtered = query
      ? active.filter((vendor) => vendor.name.toLowerCase().includes(query))
      : active;
    return filtered.slice(0, 50);
  }, [active, query]);

  const exact = active.find((vendor) => vendor.name.trim().toLowerCase() === query);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Input
          id={id}
          value={value}
          placeholder={isCustomer ? "Select customer or type payer name" : "Select vendor or type payee name"}
          autoComplete="off"
          className={cn("pr-8", exact && "border-primary/40 bg-primary/5")}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={isCustomer ? "Toggle customer list" : "Toggle vendor list"}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onMouseDown={(event) => {
            event.preventDefault();
            setOpen((prev) => !prev);
          }}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-md border bg-popover shadow-lg">
          {matches.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {query ? `No ${noun}s matching "${value.trim()}"` : `No ${noun}s in directory`}
            </div>
          ) : (
            matches.map((vendor) => (
              <button
                key={vendor.id}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(vendor.name);
                  setOpen(false);
                }}
              >
                <Check className={cn("h-3.5 w-3.5 shrink-0", exact?.id === vendor.id ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1 truncate">{vendor.name}</span>
                {vendor.currency ? <span className="text-xs text-muted-foreground">{vendor.currency}</span> : null}
              </button>
            ))
          )}
          {query && !exact && (
            <button
              type="button"
              className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent"
              onMouseDown={(event) => {
                event.preventDefault();
                onChange(value.trim());
                setOpen(false);
              }}
            >
              Use &ldquo;{value.trim()}&rdquo; (manual entry)
            </button>
          )}
        </div>
      )}
      {query && !exact && (
        <p className="mt-1 text-xs text-muted-foreground">Not in the {noun} list — this name will be saved as typed.</p>
      )}
    </div>
  );
}
