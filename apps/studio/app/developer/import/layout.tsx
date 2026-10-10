import type { ReactNode } from "react";
import { ImportNav } from "./_components/common";

/** Import Studio (PAS-10 M3-WO8): an internal Developer workspace over the /api/import surface. */
export default function ImportLayout({ children }: { children: ReactNode }) {
  return (
    <div className="imp-shell">
      <ImportNav />
      <div className="imp-shell__main">{children}</div>
    </div>
  );
}
