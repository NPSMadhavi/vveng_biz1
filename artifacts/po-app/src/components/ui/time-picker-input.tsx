import { useEffect, useMemo, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type TimePickerInputProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
};

type Parts12 = { hour12: number; minute: number; ampm: "AM" | "PM" };
type PartKey = "hour" | "minute" | "ampm";

function parseTo12(value: string): Parts12 {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  let hour24 = 8;
  let minute = 0;
  if (match) {
    hour24 = Math.min(23, Math.max(0, Number(match[1]) || 0));
    minute = Math.min(59, Math.max(0, Number(match[2]) || 0));
  }
  const ampm: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, minute, ampm };
}

function to24(parts: Parts12): string {
  let hour24 = parts.hour12 % 12;
  if (parts.ampm === "PM") hour24 += 12;
  return `${String(hour24).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function formatDisplay(value: string): string {
  const { hour12, minute, ampm } = parseTo12(value);
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${ampm}`;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

const hideScrollbarClass =
  "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden";

function ScrollCol({
  items,
  selected,
  onSelect,
  label,
}: {
  items: Array<string | number>;
  selected: string | number;
  onSelect: (v: string | number) => void;
  label: string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center" });
  }, [selected]);

  return (
    <div className="flex flex-col" aria-label={label}>
      <div
        ref={listRef}
        className={cn("max-h-48 overflow-y-auto px-1 py-1", hideScrollbarClass)}
      >
        {items.map((item) => {
          const isActive = String(item) === String(selected);
          return (
            <button
              key={String(item)}
              type="button"
              ref={isActive ? activeRef : undefined}
              className={cn(
                "flex h-8 w-12 items-center justify-center rounded-md text-sm tabular-nums",
                isActive
                  ? "bg-[#2563EB] font-semibold text-white"
                  : "text-[#111827] hover:bg-muted",
              )}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelect(item);
              }}
            >
              {typeof item === "number" ? String(item).padStart(2, "0") : item}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TimePickerInput({ value, onChange, className, disabled }: TimePickerInputProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Parts12>(() => parseTo12(value));
  const draftRef = useRef(draft);
  const pickedRef = useRef<Set<PartKey>>(new Set());
  const ignoreOpenRef = useRef(false);

  draftRef.current = draft;

  const display = useMemo(
    () => (open ? formatDisplay(to24(draft)) : formatDisplay(value)),
    [open, draft, value],
  );

  const closeNow = () => {
    ignoreOpenRef.current = true;
    setOpen(false);
    window.setTimeout(() => {
      ignoreOpenRef.current = false;
    }, 200);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && ignoreOpenRef.current) return;
    if (nextOpen) {
      const parsed = parseTo12(value);
      draftRef.current = parsed;
      setDraft(parsed);
      pickedRef.current = new Set();
    }
    setOpen(nextOpen);
  };

  const selectPart = (key: PartKey, patch: Partial<Parts12>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    onChange(to24(next));

    pickedRef.current.add(key);

    // Flow: Hour → Minute → AM/PM. Close when AM/PM is chosen,
    // or when all three columns were clicked in this open session.
    const allThree =
      pickedRef.current.has("hour")
      && pickedRef.current.has("minute")
      && pickedRef.current.has("ampm");
    if (key === "ampm" || allThree) {
      closeNow();
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors",
            "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className="tabular-nums">{display}</span>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-2"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => {
          // allow normal outside close
          void event;
        }}
      >
        <div className="flex gap-1">
          <ScrollCol
            label="Hours"
            items={HOURS}
            selected={draft.hour12}
            onSelect={(v) => selectPart("hour", { hour12: Number(v) })}
          />
          <ScrollCol
            label="Minutes"
            items={MINUTES}
            selected={draft.minute}
            onSelect={(v) => selectPart("minute", { minute: Number(v) })}
          />
          <ScrollCol
            label="AM/PM"
            items={["AM", "PM"]}
            selected={draft.ampm}
            onSelect={(v) => selectPart("ampm", { ampm: v as "AM" | "PM" })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
