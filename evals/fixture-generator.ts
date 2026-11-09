/**
 * Deterministic "bulk" part of the eval fixture (#466).
 *
 * The committed notes in evals/fixture-vault/ are small and hand-written.
 * This generator adds a few hundred more notes on top of them, from a fixed
 * seed, so link maps, backlinks, search results and folder listings are
 * large enough that an agent has to page with limit/offset/nextOffset, and
 * a second long note has to be read in pages.
 *
 * Nothing is written to disk by the harness: the notes are generated in
 * memory each time the eval or the answer-key check starts. The same seed
 * always gives the same notes, byte for byte. To look at them, run
 *
 *   npx tsx evals/fixture-generator.ts <out-dir>
 *
 * The world: river monitoring stations (stations/), the staff who look
 * after them (staff/), field visit reports (visits/), a few spare-part notes
 * (parts/) and a long calibration ledger (reference/Calibration Ledger.md).
 * Visit reports link to their technician, the station, the Field Protocol
 * and sometimes a spare part; most spare parts have no note, so they show
 * up as unresolved links.
 *
 * Eval-only code: nothing under evals/ is imported by src/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Seed of the committed answer key. Changing it changes the answers in
 * evals/vault.xml; tests/evals/answers.test.ts then tells you which ones.
 * 505 was picked because every "most"/"earliest" answer is unique by a
 * clear margin and the decoy part (with a note) outnumbers the answer.
 */
export const BULK_SEED = 505;

export interface GeneratedNote {
  path: string;
  content: string;
}

/** mulberry32: small, fast, deterministic 32-bit PRNG. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RIVERS = ['Aller', 'Birke', 'Corra', 'Dunst', 'Elm'] as const;
const FIRST = ['Anna', 'Ben', 'Clara', 'David', 'Elif', 'Felix', 'Greta', 'Hugo', 'Ines', 'Jonas',
  'Kira', 'Luis', 'Maya', 'Noah', 'Olga', 'Paul', 'Rosa', 'Sven', 'Tara', 'Umut'] as const;
const LAST = ['Arnold', 'Brandt', 'Costa', 'Dietz', 'Eder', 'Frank', 'Graf', 'Haas', 'Iversen', 'Jung',
  'Krause', 'Lindner', 'Moreau', 'Novak', 'Ortiz', 'Peters', 'Quast', 'Roth', 'Sauer', 'Thiel'] as const;
const TEAMS = ['North', 'South', 'Lab'] as const;

/** Spare parts. The first PART_NOTES of them have a note in parts/. */
const PARTS = [
  'Pressure Probe PX-7', 'Seal Kit SK-2', 'Battery Pack B12', 'Logger Board LB-4', 'Solar Panel SP-20',
  'Cable Gland CG-9', 'Desiccant Pouch DP-1', 'Antenna AN-3', 'Float Switch FS-5', 'Mounting Bracket MB-8',
  'Fuse Holder FH-2', 'Intake Screen IS-6', 'Thermistor TH-4', 'Modem Card MC-1',
] as const;
const PART_NOTES = 5;

const ISSUES = ['corrosion', 'ice', 'power', 'vandalism', 'sediment'] as const;

/** Relative weight of each month (Jan..Dec) for visit dates. */
const MONTH_WEIGHTS = [6, 6, 8, 9, 10, 9, 12, 9, 8, 9, 7, 6];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const STATION_COUNT = 48;
export const STAFF_COUNT = 20;
export const VISIT_COUNT = 360;
export const LEDGER_ROWS = 1400;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function pickWeighted(rng: () => number, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

function isoDate(month: number, day: number): string {
  return `2025-${pad(month + 1)}-${pad(day)}`;
}

interface Station {
  id: string;
  river: string;
  elevation: number;
  installed: string;
  maintainer: string;
  retired: string | null;
}

interface Staff {
  name: string;
  role: string;
  team: string;
  joined: number;
}

interface Visit {
  date: string;
  station: Station;
  technician: string;
  outcome: 'ok' | 'repair' | 'replaced';
  issue: string | null;
  part: string | null;
  remark: string;
  pressure: string;
  temp: string;
}

function makeStaff(rng: () => number): Staff[] {
  const names = new Set<string>();
  while (names.size < STAFF_COUNT) names.add(`${pick(rng, FIRST)} ${pick(rng, LAST)}`);
  return [...names].map((name, i) => ({
    name,
    // 12 field technicians, 4 hydrologists, 4 data analysts.
    role: i < 12 ? 'Field Technician' : i < 16 ? 'Hydrologist' : 'Data Analyst',
    team: pick(rng, TEAMS),
    joined: 2015 + Math.floor(rng() * 10),
  }));
}

function makeStations(rng: () => number, staff: Staff[]): Station[] {
  const technicians = staff.filter((s) => s.role === 'Field Technician');
  const stations: Station[] = [];
  for (let i = 1; i <= STATION_COUNT; i++) {
    stations.push({
      id: `ST-${pad(i)}`,
      river: pick(rng, RIVERS),
      elevation: 120 + Math.floor(rng() * 900),
      installed: `${String(2018 + Math.floor(rng() * 6))}-${pad(1 + Math.floor(rng() * 12))}-${pad(1 + Math.floor(rng() * 28))}`,
      maintainer: pick(rng, technicians).name,
      retired: null,
    });
  }
  // Six stations were taken out of service in the second half of 2025,
  // each on a different day.
  const retiredDays = new Set<string>();
  while (retiredDays.size < 6) {
    const month = 6 + Math.floor(rng() * 6);
    retiredDays.add(isoDate(month, 1 + Math.floor(rng() * DAYS_IN_MONTH[month])));
  }
  const chosen = new Set<number>();
  while (chosen.size < 6) chosen.add(Math.floor(rng() * stations.length));
  const days = [...retiredDays];
  [...chosen].forEach((idx, i) => {
    stations[idx].retired = days[i];
  });
  return stations;
}

const OK_REMARKS = [
  'Enclosure dry, no faults found.',
  'Battery swapped as scheduled.',
  'Intake checked and clear.',
  'Readings match the reference gauge.',
  'Fence and signage intact.',
  'Logger clock re-synchronised.',
];
/** The "blocked intake" remark, worded so a plain keyword search misses it. */
export const CHOKED_REMARK = 'Leaves had choked the intake grate; raked it free before measuring.';

function makeVisits(rng: () => number, stations: Station[], technicians: string[]): Visit[] {
  const visits: Visit[] = [];
  const keys = new Set<string>();
  // Lena Fischer (from the hand-written notes) does about a fifth of all
  // visits, so her backlinks need more than one page.
  const techWeights = technicians.map((t) => (t === 'Lena Fischer' ? 3 : 1));
  while (visits.length < VISIT_COUNT) {
    const month = pickWeighted(rng, MONTH_WEIGHTS);
    const date = isoDate(month, 1 + Math.floor(rng() * DAYS_IN_MONTH[month]));
    const station = pick(rng, stations);
    if (station.retired !== null && date >= station.retired) continue;
    const key = `${date} ${station.id}`;
    if (keys.has(key)) continue;
    keys.add(key);
    const technician = technicians[pickWeighted(rng, techWeights)];
    const roll = rng();
    const outcome = roll < 0.62 ? 'ok' : roll < 0.84 ? 'repair' : 'replaced';
    let issue: string | null = null;
    if (rng() < 0.35) {
      const winter = month <= 1 || month === 11;
      issue = winter && rng() < 0.6 ? 'ice' : pick(rng, ISSUES.filter((i) => i !== 'ice'));
    }
    let part: string | null = null;
    if (outcome !== 'ok') {
      // Bias towards a few parts so the counts are not all ties.
      const weights = PARTS.map((_, i) => (i === 1 ? 6 : i === 7 ? 5 : i < 8 ? 3 : 2));
      part = PARTS[pickWeighted(rng, weights)];
    }
    const remark = rng() < 0.07 ? CHOKED_REMARK : pick(rng, OK_REMARKS);
    visits.push({
      date,
      station,
      technician,
      outcome,
      issue,
      part,
      remark,
      pressure: (98 + rng() * 8).toFixed(1),
      temp: (1 + rng() * 12).toFixed(1),
    });
  }
  return visits.sort((a, b) => (a.date === b.date ? a.station.id.localeCompare(b.station.id) : a.date.localeCompare(b.date)));
}

function staffNote(s: Staff): string {
  return `---
role: ${s.role}
team: ${s.team}
joined: ${String(s.joined)}
---
# ${s.name}

${s.role} in the ${s.team} team since ${String(s.joined)}. #person
`;
}

function stationNote(s: Station): string {
  const status = s.retired === null ? 'operational' : 'retired';
  const retired = s.retired === null ? '' : `retired: ${s.retired}\n`;
  const fate =
    s.retired === null
      ? 'Reports every six hours.'
      : `Taken out of service on ${s.retired}; the mast was removed.`;
  return `---
river: ${s.river}
elevation: ${String(s.elevation)}
installed: ${s.installed}
status: ${status}
${retired}maintainer: ${s.maintainer}
---
# ${s.id}

Pressure station on the ${s.river}, ${String(s.elevation)} m above sea level. Looked after by [[${s.maintainer}]]. ${fate} #station
`;
}

function visitNote(v: Visit): string {
  const tags = v.issue === null ? '#visit' : `#visit #issue/${v.issue}`;
  const part = v.part === null ? '' : `\nSpare part fitted: [[${v.part}]]\n`;
  return `---
date: ${v.date}
station: ${v.station.id}
outcome: ${v.outcome}
---
# ${v.station.id} visit ${v.date}

Station: [[${v.station.id}]]
Technician: [[${v.technician}]]

Followed the [[Field Protocol]]. Pressure ${v.pressure} kPa, water ${v.temp} C.

${v.remark}
${part}
${tags}
`;
}

function partNote(name: string, i: number): string {
  return `---
supplier: ${['Hydrotec', 'Nordmess', 'Riverline'][i % 3]}
stock: ${String(3 + i * 2)}
---
# ${name}

Spare part kept in the depot. #part
`;
}

function ledgerNote(rng: () => number, stations: Station[], technicians: string[]): string {
  const rows: string[] = [];
  // Two or three rows a day from 2024-07-01, so the table spans 18 months.
  const start = Date.UTC(2024, 6, 1);
  for (let i = 0; i < LEDGER_ROWS; i++) {
    const day = new Date(start + Math.floor(i * 0.4) * 86_400_000).toISOString().slice(0, 10);
    let station = pick(rng, stations);
    while (station.retired !== null && day >= station.retired) station = pick(rng, stations);
    const offset = ((rng() - 0.5) * 0.6).toFixed(2).replace('-0.00', '0.00');
    rows.push(`| ${day} | ${station.id} | ${pick(rng, technicians)} | ${offset} |`);
  }
  return `# Calibration Ledger

Zero-offset corrections in kPa applied to the pressure probes, oldest first. Kept by the Lab team. #log

| Date | Station | Technician | Offset (kPa) |
| --- | --- | --- | --- |
${rows.join('\n')}
`;
}

/** Generate the bulk notes for `seed`. Paths are vault-relative. */
export function generateBulkNotes(seed: number = BULK_SEED): GeneratedNote[] {
  const rng = createRng(seed);
  const staff = makeStaff(rng);
  const stations = makeStations(rng, staff);
  const technicians = [
    ...staff.filter((s) => s.role === 'Field Technician').map((s) => s.name),
    'Lena Fischer',
  ];
  const visits = makeVisits(rng, stations, technicians);
  const notes: GeneratedNote[] = [
    ...staff.map((s) => ({ path: `staff/${s.name}.md`, content: staffNote(s) })),
    ...stations.map((s) => ({ path: `stations/${s.id}.md`, content: stationNote(s) })),
    ...visits.map((v) => ({ path: `visits/${v.date} ${v.station.id}.md`, content: visitNote(v) })),
    ...PARTS.slice(0, PART_NOTES).map((p, i) => ({ path: `parts/${p}.md`, content: partNote(p, i) })),
    { path: 'reference/Calibration Ledger.md', content: ledgerNote(rng, stations, technicians) },
  ];
  return notes;
}

function main(): void {
  const out = process.argv[2];
  if (!out) {
    process.stderr.write('Usage: npx tsx evals/fixture-generator.ts <out-dir>\n');
    process.exit(2);
  }
  const notes = generateBulkNotes();
  for (const note of notes) {
    const full = join(resolve(out), note.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, note.content);
  }
  process.stdout.write(`Wrote ${String(notes.length)} notes to ${resolve(out)}\n`);
}

if (process.argv[1]?.endsWith('fixture-generator.ts')) {
  main();
}
