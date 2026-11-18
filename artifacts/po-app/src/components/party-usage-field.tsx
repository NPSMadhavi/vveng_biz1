import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { PartyUsage } from "@/lib/party-usage";

export function PartyUsageField({
  value,
  onChange,
}: {
  value: PartyUsage;
  onChange: (value: PartyUsage) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Transactions</Label>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next === "manpower" ? "manpower" : "general")}
        className="grid gap-2 sm:grid-cols-2"
      >
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 text-sm">
          <RadioGroupItem value="general" />
          General
        </label>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 text-sm">
          <RadioGroupItem value="manpower" />
          Man power supply
        </label>
      </RadioGroup>
    </div>
  );
}
