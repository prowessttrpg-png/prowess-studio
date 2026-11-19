"use client";

import { useParams } from "next/navigation";
import { EncounterWorkspace } from "../_components/EncounterWorkspace";

/** /encounters/:encounterId — prepare one encounter's sides and roster, or read an archived one (M7-WO1). */
export default function EncounterPage() {
  const { encounterId } = useParams<{ encounterId: string }>();
  return <EncounterWorkspace id={encounterId} />;
}
