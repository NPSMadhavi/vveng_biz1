type AssignedEmployee = { name?: string | null };

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function manpowerLineFromCustomer(customer: {
  assignedEmployees?: AssignedEmployee[] | null;
  perHourAmount?: string | number | null;
}) {
  const names = (customer.assignedEmployees || [])
    .map((employee) => String(employee.name || "").trim())
    .filter(Boolean);
  if (names.length === 0) return null;
  const rate = Number(customer.perHourAmount);
  const unitPrice = Number.isFinite(rate) && rate > 0
    ? Math.round(rate * names.length * 100) / 100
    : 0;
  const description = [
    "<p>Man power supplier charges</p>",
    ...names.map((name, index) => `<p>${index + 1}. ${escapeHtml(name)}</p>`),
  ].join("");
  return { description, unitPrice, uom: "Hour" };
}
