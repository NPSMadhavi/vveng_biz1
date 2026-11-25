/** True when company country is Singapore (full name or ISO code SG). */
export function isSingaporeCountry(country: string | null | undefined): boolean {
  const c = (country || "").trim().toLowerCase();
  return c === "singapore" || c === "sg" || c === "singapore, sg";
}

/** True when company country is India (full name or ISO code IN). */
export function isIndiaCountry(country: string | null | undefined): boolean {
  const c = (country || "").trim().toLowerCase();
  return c === "india" || c === "in" || c === "india, in";
}

/** True when accounting features are enabled for the company's country (Singapore or India). */
export function isAccountingSupportedCountry(country: string | null | undefined): boolean {
  return isSingaporeCountry(country) || isIndiaCountry(country);
}
