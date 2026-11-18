"use client";

import { Suspense } from "react";
import { NewDefinitionForm } from "../_components/NewDefinitionForm";

/** /compendium/admin/new — Create Definition (PAS-10 M6-WO1 §10; PRE-M7-WO1 reads ?kind / ?returnTo for child Drafts). */
export default function NewDefinitionPage() {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <NewDefinitionForm />
    </Suspense>
  );
}
