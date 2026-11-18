import { useCallback } from "react";
import { useLocation } from "wouter";

const DOC_PATHS: [string, string][] = [
  ["/purchase-quotations", "/manpower/suppliers/quotations"],
  ["/purchase-orders", "/manpower/suppliers/purchase-orders"],
  ["/vendor-invoices", "/manpower/suppliers/vendor-invoices"],
  ["/sales-orders", "/manpower/customers/sales-orders"],
  ["/quotations", "/manpower/customers/quotations"],
  ["/invoices", "/manpower/customers/tax-invoices"],
];

export function rewriteDocPath(currentPath: string, href: string) {
  if (!currentPath.split("?")[0].startsWith("/manpower/")) return href;
  const queryAt = href.indexOf("?");
  const path = queryAt === -1 ? href : href.slice(0, queryAt);
  const query = queryAt === -1 ? "" : href.slice(queryAt);
  for (const [general, manpower] of DOC_PATHS) {
    if (path === general || path.startsWith(`${general}/`)) {
      return manpower + path.slice(general.length) + query;
    }
  }
  return href;
}

export function useDocNav() {
  const [location, setLocation] = useLocation();
  const go = useCallback((href: string) => {
    setLocation(rewriteDocPath(location, href));
  }, [location, setLocation]);
  const href = useCallback((path: string) => rewriteDocPath(location, path), [location]);
  return { location, setLocation: go, href };
}
