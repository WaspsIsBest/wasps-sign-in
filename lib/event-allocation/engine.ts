import type { ImportEntry, ImportVolunteer, ValidationIssue } from "@/lib/event-import/types";
import {
  ALL_BAYS,
  ASSIST_RO_ONLY_NAMES,
  ASSIST_RO_ONLY_WASRA,
  DEFAULT_MCID,
  DETAIL_COUNT,
  ELECTRONIC_POOL,
  EXCLUDED_FROM_OFFICIAL_ROLES,
  FIXED_BAYS,
  NINETY_START_BAY,
  PAPER_PREFERRED_BAYS,
  VOL_ROLES,
} from "./rules";
import type {
  AllocationResult,
  Bays,
  ClassMapping,
  RawEntry,
  Shooter,
  VolunteerRow,
} from "./types";

// ---------------------------------------------------------------- helpers

const norm = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

const isPaperText = (t: string) => norm(t).includes("paper");
const isElectronicText = (t: string) => norm(t).includes("electronic");

function distanceBand(distance: string): "90" | "50" | "20" {
  if (distance.includes("90")) return "90";
  if (distance.includes("20")) return "20";
  return "50";
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const choice = <T,>(items: T[], rng: () => number): T =>
  items[Math.floor(rng() * items.length)];

function computeCScore(shootingClass: string, position: string) {
  // Benchrest is always eligible. Every other class is only eligible when the
  // shooter's chosen position is Prone, at any distance or target type.
  if (norm(shootingClass).includes("benchrest")) return true;
  return norm(position).includes("prone");
}

// -------------------------------------------------------------- allocation

export function allocateEvent(opts: {
  rows: RawEntry[];
  eventDate: string;
  classMappings: ClassMapping[];
  startWeid: number;
  rng?: () => number;
}): AllocationResult {
  const rng = opts.rng ?? Math.random;
  const issues: ValidationIssue[] = [];
  const warn = (message: string, row?: number) =>
    issues.push({ severity: "warning", message, row });
  const info = (message: string) =>
    issues.push({ severity: "warning", message });

  // ---- 1. this event's rows
  const dayRows = opts.rows.filter((r) => r.eventDate === opts.eventDate);

  // ---- 2. class mapping (match on the full TryBooking label + distance)
  const mappingByKey = new Map<string, ClassMapping>();
  for (const m of opts.classMappings) {
    if (m.is_active === false) continue;
    const key = `${norm(m.source_shooting_class)}|${norm(m.distance)}`;
    if (!mappingByKey.has(key)) mappingByKey.set(key, m);
  }

  // ---- 3. duplicate competitors: keep the FIRST entry for each person
  const seenKeys = new Map<string, RawEntry[]>();
  for (const r of dayRows) {
    const key =
      r.wasra !== null && r.wasra > 0
        ? `wasra:${r.wasra}`
        : `name:${norm(r.fname)}_${norm(r.surname)}`;
    const list = seenKeys.get(key) ?? [];
    list.push(r);
    seenKeys.set(key, list);
  }

  const uniqueRows: RawEntry[] = [];
  const duplicated: string[] = [];
  for (const r of dayRows) {
    const key =
      r.wasra !== null && r.wasra > 0
        ? `wasra:${r.wasra}`
        : `name:${norm(r.fname)}_${norm(r.surname)}`;
    const list = seenKeys.get(key)!;
    if (list[0] === r) {
      uniqueRows.push(r);
      if (list.length > 1) {
        duplicated.push(
          `${r.fname} ${r.surname} (${list.length} entries, rows ${list
            .map((x) => x.rowNumber)
            .join(", ")})`,
        );
      }
    }
  }
  if (duplicated.length) {
    warn(
      `${duplicated.length} competitor(s) appear more than once for this date. Keeping the first entry for each: ${duplicated.join("; ")}.`,
    );
  }

  // ---- 4. WEIDs: alphabetical by first name, as before
  const sorted = [...uniqueRows].sort((a, b) => {
    const x = a.fname.toLowerCase();
    const y = b.fname.toLowerCase();
    return x < y ? -1 : x > y ? 1 : a.rowNumber - b.rowNumber;
  });

  const unmapped: string[] = [];
  const nullMcid = new Set<string>();

  const shooters: Shooter[] = sorted.map((r, i) => {
    const mapping = mappingByKey.get(
      `${norm(r.shootingClass)}|${norm(r.distance)}`,
    );
    if (!mapping || mapping.fkcid === null || mapping.fkcid === undefined) {
      unmapped.push(
        `${r.fname} ${r.surname} (${r.shootingClass || "no class"}, ${r.distance || "no distance"})`,
      );
    } else if (mapping.mcid === null || mapping.mcid === undefined) {
      nullMcid.add(`${r.shootingClass} ${r.distance}`);
    }

    return {
      weid: opts.startWeid + i,
      rowNumber: r.rowNumber,
      bookingId: r.bookingId,
      fname: r.fname,
      surname: r.surname,
      competitor: `${r.surname.trim()},${r.fname.trim()}`,
      wasra: r.wasra,
      targetTypeRaw: r.targetType,
      targetCode: isElectronicText(r.targetType) ? "E" : "P",
      isPaper: isPaperText(r.targetType),
      isElectronic: isElectronicText(r.targetType),
      distance: r.distance,
      band: distanceBand(r.distance),
      shootingClass: r.shootingClass,
      position: r.position,
      cscore: computeCScore(r.shootingClass, r.position),
      fkcid: mapping?.fkcid ?? null,
      mcid: mapping?.mcid ?? DEFAULT_MCID,
      mappingMcid: mapping?.mcid ?? null,
      sharingWith: r.sharingWith,
      volunteerRole: r.volunteerRole,
      d: [null, null, null, null] as Bays,
    };
  });

  if (unmapped.length) {
    warn(
      `${unmapped.length} entrant(s) did not match any class mapping (new or renamed class or distance?). They are still given bays but will import without a class: ${unmapped.join("; ")}.`,
    );
  }
  if (nullMcid.size) {
    info(
      `Class mapping(s) with no MCID stored in Supabase (${[...nullMcid].join(", ")}). MCID ${DEFAULT_MCID} is used for the start list, but these entries may not link to their class on import. Fill in MCID ${DEFAULT_MCID} on those class_mappings rows if so.`,
    );
  }

  const idxAll = shooters.map((_, i) => i);
  const nameOf = (i: number) => `${shooters[i].fname} ${shooters[i].surname}`;

  // ---- bay allocation state
  const usedD1 = new Set<number>();
  const usedD2 = new Set<number>();
  const overflow: number[] = [];
  const assignedShared = new Set<number>();
  const d2Owner = new Map<number, number>();

  const fixedBayNumbers = new Set(Object.values(FIXED_BAYS));
  const isFixed = (i: number) =>
    shooters[i].wasra !== null && shooters[i].wasra! in FIXED_BAYS;

  // Step 1: fixed bays
  for (const i of idxAll) {
    if (isFixed(i)) {
      const bay = FIXED_BAYS[shooters[i].wasra!];
      shooters[i].d[0] = bay;
      usedD1.add(bay);
    }
  }

  // ---- bay-sharing partners
  const searchTaken = new Set<number>();
  let sharePairs: [number, number][] = [];

  const sharingBlank = (t: string) => {
    const n = norm(t);
    return n === "" || n === "nan" || n === "none";
  };

  function findPartner(i: number): number | null {
    const text = norm(shooters[i].sharingWith);
    if (sharingBlank(shooters[i].sharingWith)) return null;
    // Split on anything that isn't a letter or digit so "Kaden," still matches.
    const words = text.split(/[^a-z0-9'-]+/).filter(Boolean);
    const candidates: number[] = [];
    for (const j of idxAll) {
      if (j === i || searchTaken.has(j)) continue;
      const full = norm(`${shooters[j].fname} ${shooters[j].surname}`);
      const first = norm(shooters[j].fname);
      if (full && text.includes(full)) candidates.push(j);
      else if (first && words.includes(first)) candidates.push(j);
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  for (const i of idxAll) {
    if (searchTaken.has(i) || isFixed(i)) continue;
    const partner = findPartner(i);
    if (partner !== null) {
      sharePairs.push([i, partner]);
      searchTaken.add(i);
      searchTaken.add(partner);
    } else if (!sharingBlank(shooters[i].sharingWith)) {
      warn(
        `Could not match the bay-sharing partner for ${nameOf(i)} (entered: "${shooters[i].sharingWith}"). They get an individual bay instead. Check the spelling they entered.`,
        shooters[i].rowNumber,
      );
    }
  }

  const sharedPartner = new Map<number, number>();
  for (const [a, b] of sharePairs) {
    sharedPartner.set(a, b);
    sharedPartner.set(b, a);
  }

  // ---- Step 2: size and place the 90m block
  const ninetyIdxs = idxAll.filter(
    (i) => shooters[i].isPaper && shooters[i].band === "90",
  );
  const counted = new Set<number>();
  let ninetyUnits = 0;
  for (const i of ninetyIdxs) {
    if (counted.has(i)) continue;
    counted.add(i);
    const partner = sharedPartner.get(i);
    if (partner !== undefined && ninetyIdxs.includes(partner)) {
      counted.add(partner);
    }
    ninetyUnits += 1; // a sharing pair needs only one bay
  }

  const ninetyBlock: number[] = [];
  for (let b = NINETY_START_BAY; b >= 1 && ninetyBlock.length < ninetyUnits; b--) {
    if (fixedBayNumbers.has(b)) {
      warn(`Bay ${b} is a fixed allocation, so it was skipped when building the 90m block.`);
    } else {
      ninetyBlock.push(b);
    }
  }
  if (ninetyUnits && ninetyBlock.length < ninetyUnits) {
    warn(`Only ${ninetyBlock.length} bay(s) could be found for ${ninetyUnits} 90m allocation(s).`);
  }

  // ---- Step 3: range-safety buffer bay below the lowest 90m bay
  let safetyBay: number | null = ninetyBlock.length
    ? Math.min(...ninetyBlock) - 1
    : null;
  if (safetyBay !== null && safetyBay < 1) safetyBay = null;
  if (safetyBay !== null && fixedBayNumbers.has(safetyBay)) {
    warn(`Safety buffer bay ${safetyBay} is already a fixed allocation. Check range safety manually.`);
  }

  const blocked = (bay: number) =>
    ninetyBlock.includes(bay) || (safetyBay !== null && bay === safetyBay);

  function preferenceOrder(i: number): number[] {
    const s = shooters[i];
    if (s.isPaper) {
      if (s.band === "90") return [...ninetyBlock]; // 32 downwards
      const order = PAPER_PREFERRED_BAYS.filter((b) => !blocked(b));
      for (const b of ALL_BAYS) {
        if (!order.includes(b) && !blocked(b)) order.push(b);
      }
      return order;
    }
    if (s.isElectronic) {
      return shuffle(ELECTRONIC_POOL.filter((b) => !blocked(b)), rng);
    }
    return [];
  }

  const assignD1 = (i: number, bay: number) => {
    shooters[i].d[0] = bay;
    usedD1.add(bay);
  };

  const assignPair = (a: number, b: number, bay: number) => {
    shooters[a].d[0] = bay;
    shooters[a].d[1] = null;
    shooters[b].d[0] = null;
    shooters[b].d[1] = bay;
    usedD1.add(bay);
    usedD2.add(bay);
    d2Owner.set(bay, b);
    assignedShared.add(a);
    assignedShared.add(b);
  };

  // ---- Step 3b: a 50m paper shooter takes the safety buffer bay
  if (
    safetyBay !== null &&
    !usedD1.has(safetyBay) &&
    !fixedBayNumbers.has(safetyBay)
  ) {
    const fiftyPaper = idxAll.filter(
      (i) =>
        shooters[i].isPaper &&
        shooters[i].band === "50" &&
        shooters[i].d[0] === null &&
        !isFixed(i),
    );
    const solo = fiftyPaper.filter((i) => !sharedPartner.has(i));
    if (solo.length) {
      assignD1(choice(solo, rng), safetyBay);
    } else if (fiftyPaper.length) {
      const pick = fiftyPaper[0];
      const partner = sharedPartner.get(pick)!;
      assignPair(pick, partner, safetyBay);
      sharePairs = sharePairs.filter((p) => !p.includes(pick));
    } else {
      warn(
        `No 50m paper shooter entered, so safety buffer bay ${safetyBay} is left EMPTY and blocked next to the 90m block.`,
      );
    }
  }

  // ---- Step 4: bay-sharing pairs
  for (const [a, b] of sharePairs) {
    if (assignedShared.has(a) || assignedShared.has(b)) continue;
    const pool = preferenceOrder(a).filter(
      (bay) => !usedD1.has(bay) && !usedD2.has(bay),
    );
    if (!pool.length) {
      warn(
        `No bay available to share between ${nameOf(a)} and ${nameOf(b)}. Both fall back to individual assignment.`,
      );
      continue;
    }
    assignPair(a, b, shooters[a].isPaper ? pool[0] : choice(pool, rng));
  }

  // ---- Step 5: everyone else (90m, then other paper, then electronic)
  const remaining = idxAll.filter(
    (i) => shooters[i].d[0] === null && !assignedShared.has(i),
  );
  const orderKey = (i: number) =>
    shooters[i].isPaper && shooters[i].band === "90"
      ? 0
      : shooters[i].isPaper
        ? 1
        : 2;
  remaining.sort((a, b) => {
    const k = orderKey(a) - orderKey(b);
    if (k !== 0) return k;
    const x = shooters[a].competitor;
    const y = shooters[b].competitor;
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const unrecognised = new Set<string>();
  for (const i of remaining) {
    if (!shooters[i].isPaper && !shooters[i].isElectronic) {
      unrecognised.add(shooters[i].targetTypeRaw);
    }
    const pool = preferenceOrder(i).filter((bay) => !usedD1.has(bay));
    if (pool.length) {
      assignD1(i, shooters[i].isPaper ? pool[0] : choice(pool, rng));
    } else {
      overflow.push(i);
    }
  }
  if (unrecognised.size) {
    warn(
      `Unrecognised target type value(s) (no bay pool defined): ${[...unrecognised].map((v) => `"${v}"`).join(", ")}.`,
    );
  }

  // ---- Step 6: every bay used, so start sharing on details 2/4
  for (const i of overflow) {
    const pool = preferenceOrder(i).filter((bay) => !usedD2.has(bay));
    if (pool.length) {
      const bay = shooters[i].isPaper ? pool[0] : choice(pool, rng);
      shooters[i].d[1] = bay;
      usedD2.add(bay);
      d2Owner.set(bay, i);
    }
  }

  // Everyone else shoots the same bay on details 2/4 unless another person
  // already owns that bay's detail 2/4 slot.
  for (const i of idxAll) {
    if (assignedShared.has(i)) continue;
    if (shooters[i].d[1] === null) {
      const bay = shooters[i].d[0];
      if (bay === null) continue;
      const owner = d2Owner.get(bay);
      if (owner !== undefined && owner !== i) continue;
      shooters[i].d[1] = bay;
      d2Owner.set(bay, i);
    }
  }

  for (const s of shooters) {
    s.d[2] = s.d[0];
    s.d[3] = s.d[1];
  }

  const unassigned = shooters.filter((s) => s.d[0] === null && s.d[1] === null);
  if (unassigned.length) {
    warn(
      `${unassigned.length} shooter(s) could not be given a bay in either detail (bay pool exhausted): ${unassigned.map((s) => s.competitor).join("; ")}.`,
    );
  }

  // ---- available bays: free across all four details
  const usedAll = new Set<number>();
  for (const s of shooters) {
    for (const b of s.d) if (b !== null) usedAll.add(b);
  }
  const availableBays = ALL_BAYS.filter(
    (b) => !usedAll.has(b) && b !== safetyBay,
  );

  // ---- volunteers
  const volunteers = allocateVolunteers(shooters, rng, issues);

  return {
    eventDate: opts.eventDate,
    shooters,
    volunteers,
    availableBays,
    ninetyBlock: [...ninetyBlock],
    safetyBay,
    issues,
  };
}

// -------------------------------------------------------------- volunteers

function allocateVolunteers(
  shooters: Shooter[],
  rng: () => number,
  issues: ValidationIssue[],
): VolunteerRow[] {
  const warn = (message: string) => issues.push({ severity: "warning", message });

  let vols = shooters.filter((s) => s.volunteerRole.trim() !== "");

  const excluded = vols.filter(
    (s) => s.wasra !== null && EXCLUDED_FROM_OFFICIAL_ROLES.has(s.wasra),
  );
  if (excluded.length) {
    warn(
      `Excluded from official volunteer roles (club rule): ${excluded.map((s) => `${s.fname} ${s.surname}`).join(", ")}.`,
    );
  }
  vols = vols.filter(
    (s) => !(s.wasra !== null && EXCLUDED_FROM_OFFICIAL_ROLES.has(s.wasra)),
  );

  const fullName = (s: Shooter) => `${s.fname.trim()} ${s.surname.trim()}`;

  const isAssistOnly = (s: Shooter) =>
    (s.wasra !== null && ASSIST_RO_ONLY_WASRA.has(s.wasra)) ||
    ASSIST_RO_ONLY_NAMES.has(fullName(s).toLowerCase());

  const unique = (names: string[]) => [...new Set(names)];

  const assistOnlyNames = unique(vols.filter(isAssistOnly).map(fullName));
  if (assistOnlyNames.length) {
    warn(
      `Assistant Range Officer only (never Range Officer): ${assistOnlyNames.join(", ")}.`,
    );
  }

  const rows: VolunteerRow[] = [];
  const blankRow = (role: string): VolunteerRow => ({
    role,
    d: ["", "", "", ""],
  });

  for (const role of VOL_ROLES) {
    const matches = vols.filter(
      (s) => norm(s.volunteerRole) === norm(role),
    );
    const pool = shuffle(
      unique(
        (role === "Range Officer"
          ? matches.filter((s) => !isAssistOnly(s))
          : matches
        ).map(fullName),
      ),
      rng,
    );

    const row = blankRow(role);
    for (let i = 0; i < DETAIL_COUNT; i++) {
      row.d[i] = pool[i] ?? "";
    }
    rows.push(row);

    if (role === "Range Officer") {
      const assistPool = [
        ...assistOnlyNames,
        ...pool.slice(DETAIL_COUNT).filter((n) => !assistOnlyNames.includes(n)),
      ];
      if (assistPool.length) {
        if (assistPool.length > DETAIL_COUNT) {
          warn(
            `${assistPool.length - DETAIL_COUNT} Assist Range Officer volunteer(s) beyond capacity were not placed: ${assistPool.slice(DETAIL_COUNT).join(", ")}.`,
          );
        }
        const assistRow = blankRow("Assist Range Officer");
        for (let i = 0; i < DETAIL_COUNT; i++) {
          assistRow.d[i] = assistPool[i] ?? "";
        }
        rows.push(assistRow);
      }
    }
  }

  return rows;
}

// ------------------------------------------------- shape for import_event

export function toImportPayload(result: AllocationResult): {
  entries: ImportEntry[];
  volunteers: ImportVolunteer[];
} {
  const entries: ImportEntry[] = result.shooters.map((s) => ({
    source_booking_id: s.bookingId,
    source_ticket_number: `event-${result.eventDate}-${s.weid}`,
    weid: String(s.weid),
    wasra_number: s.wasra ?? 0,
    first_name: s.fname,
    surname: s.surname,
    target_type: s.targetCode,
    distance: s.distance,
    shooting_class: s.shootingClass,
    // "Prone (...)" becomes "Prone", same as the file-based importer.
    position: s.position.replace(/\s*\(.*/, "").trim(),
    fkcid: s.fkcid ?? 0,
    mcid: s.mcid,
    championship_score_eligible: s.cscore,
    volunteer_preference: s.volunteerRole,
    sharing_with: s.sharingWith,
    d1: s.d[0],
    d2: s.d[1],
    d3: s.d[2],
    d4: s.d[3],
  }));

  const volunteers: ImportVolunteer[] = [];
  for (const row of result.volunteers) {
    row.d.forEach((name, i) => {
      if (name.trim()) {
        volunteers.push({
          role: row.role,
          detail_number: i + 1,
          member_name: name,
        });
      }
    });
  }

  return { entries, volunteers };
}

// Problems that must be fixed in the CSV before the event can be imported.
export function importBlockers(result: AllocationResult): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  for (const s of result.shooters) {
    if (s.wasra === null || s.wasra <= 0) {
      errors.push({
        severity: "error",
        row: s.rowNumber,
        message: `${s.fname} ${s.surname}: missing or invalid WASRA number. The import needs a valid number for every entry.`,
      });
    }
    if (!s.fname || !s.surname) {
      errors.push({
        severity: "error",
        row: s.rowNumber,
        message: "First name and surname are both required.",
      });
    }
    s.d.forEach((bay, i) => {
      if (bay !== null && (bay < 1 || bay > 99)) {
        errors.push({
          severity: "error",
          row: s.rowNumber,
          message: `Invalid D${i + 1} bay: ${bay}`,
        });
      }
    });
  }
  return errors;
}
