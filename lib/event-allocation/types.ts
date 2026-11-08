import type { ValidationIssue } from "@/lib/event-import/types";

// One row of the TryBooking entry CSV, after column matching.
export type RawEntry = {
  rowNumber: number; // spreadsheet row (header is row 1)
  eventDate: string; // ISO yyyy-mm-dd, "" if unreadable
  bookingId: string;
  targetType: string;
  distance: string;
  shootingClass: string;
  position: string;
  fname: string;
  surname: string;
  wasra: number | null;
  volunteerRole: string;
  sharingWith: string;
};

export type ParsedCsv = {
  rows: RawEntry[];
  issues: ValidationIssue[];
};

// A row from public.class_mappings.
export type ClassMapping = {
  source_shooting_class: string;
  shooting_class: string | null;
  distance: string;
  fkcid: number | null;
  mcid: number | null;
  is_active?: boolean | null;
};

export type Bays = [number | null, number | null, number | null, number | null];

export type Shooter = {
  weid: number;
  rowNumber: number;
  bookingId: string;
  fname: string;
  surname: string;
  competitor: string; // "SURNAME,Fname" as used on the start list
  wasra: number | null;
  targetTypeRaw: string;
  targetCode: "E" | "P";
  isPaper: boolean;
  isElectronic: boolean;
  distance: string;
  band: "90" | "50" | "20";
  shootingClass: string;
  position: string;
  cscore: boolean;
  fkcid: number | null; // null = no class mapping matched
  mcid: number; // effective MCID (default applied)
  mappingMcid: number | null; // MCID exactly as stored on the mapping
  sharingWith: string;
  volunteerRole: string;
  d: Bays; // D1..D4 bay numbers
};

export type VolunteerRow = {
  role: string;
  d: [string, string, string, string];
};

export type AllocationResult = {
  eventDate: string;
  shooters: Shooter[];
  volunteers: VolunteerRow[];
  availableBays: number[];
  ninetyBlock: number[];
  safetyBay: number | null;
  issues: ValidationIssue[];
};
