import type { ValidationIssue } from "@/lib/event-import/types";
import type { ParsedCsv, RawEntry } from "./types";

// One entry as returned by the list_event_entries() database function.
export type FormEntry = {
  id: number;
  submitted_at: string;
  is_visitor: boolean;
  wasra_number: number | null;
  // Members: their WASRA number. Visitors: a stable temporary number
  // (950000 + entry id) so the scoring system and import have something valid.
  effective_number: number;
  first_name: string;
  surname: string;
  target_type: string;
  distance: string;
  shooting_class: string;
  position: string;
  volunteer_role: string | null;
  sharing_with: string | null;
};

// Entries made on the public form, in the same shape the TryBooking CSV
// produces, so the allocation engine needs no changes.
export function entriesToParsed(
  eventDate: string,
  entries: FormEntry[],
): ParsedCsv {
  const rows: RawEntry[] = entries.map((e) => ({
    rowNumber: e.id,
    eventDate,
    bookingId: `form-${e.id}`,
    targetType: e.target_type,
    distance: e.distance,
    shootingClass: e.shooting_class,
    position: e.position,
    fname: e.first_name,
    surname: e.surname,
    wasra: e.effective_number,
    volunteerRole: e.volunteer_role ?? "",
    sharingWith: e.sharing_with ?? "",
  }));

  const issues: ValidationIssue[] = [];
  const visitors = entries.filter((e) => e.is_visitor);
  if (visitors.length) {
    issues.push({
      severity: "warning",
      message: `${visitors.length} visitor(s) have no WASRA number, so each was given a temporary number starting with 9 (${visitors
        .map((v) => `${v.first_name} ${v.surname}: ${v.effective_number}`)
        .join("; ")}). They will show as "not matched to a member" on import, which is expected.`,
    });
  }

  return { rows, issues };
}
