// Club rules for the weekly bay and volunteer allocation.
// Edit this file to change fixed bays, bay pools or volunteer restrictions.

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

export const DETAIL_COUNT = 4;

// Members who always get the same bay on detail 1 (keyed by WASRA number).
export const FIXED_BAYS: Record<number, number> = {
  62348: 22,
  62377: 16,
  62403: 23,
  62338: 21,
  62517: 15,
};

// Physical bays 1-32.
export const ALL_BAYS = range(1, 32);

// Bays that electronic-target shooters may be given.
export const ELECTRONIC_POOL = [...range(2, 16), ...range(21, 30)];

// 90m shooters are allocated from this bay and work back (32, 31, 30, ...).
export const NINETY_START_BAY = 32;

// First-choice bays for paper shooters who are not at 90m.
export const PAPER_PREFERRED_BAYS = [1, 32];

// Roles filled from what people tick in TryBooking. "Assist Range Officer"
// is built from the assist-only list below plus Range Officer overflow.
export const VOL_ROLES = [
  "Range Officer",
  "Trainee Range Officer",
  "Visitor Assistant",
] as const;

// Members who may only ever be an ASSISTANT Range Officer, never the Range
// Officer for a detail. Matched on WASRA number first, then on full name.
// Add Todd Dempsey's WASRA number here when known.
export const ASSIST_RO_ONLY_WASRA = new Set<number>();
export const ASSIST_RO_ONLY_NAMES = new Set<string>(["todd dempsey"]);

// Members who must never be given an official volunteer role (e.g. juniors).
// Keyed by WASRA number so a spelling change between weeks can't let them slip.
export const EXCLUDED_FROM_OFFICIAL_ROLES = new Set<number>([
  62503, // Zac/Zach Sokolenko - junior, not eligible to be an official
]);

// MCID used when a class mapping has none (all 90m rows) or doesn't match.
export const DEFAULT_MCID = 118;

// Start list export (scoring system import).
export const START_LIST_CLUB = "WA Smallbore Precision Shooters";
export const MATCH_CODE_D1 = "49004020";
export const MATCH_CODE_OTHER = "49006020";
