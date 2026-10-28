"use client";

import { Suspense } from "react";
import { AuthoringDashboard } from "./_components/AuthoringDashboard";

/** /compendium/admin — the authoring dashboard (PAS-10 M6-WO1 §4). The reference browser stays at /compendium. */
export default function CompendiumAdminPage() {
  return (
    <Suspense fallback={<p role="status">Loading Compendium Admin…</p>}>
      <AuthoringDashboard />
    </Suspense>
  );
}
