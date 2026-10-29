/**
 * CSV bulk-ingestion parser. The import format is one row per stop; rows
 * sharing a job_ref form one job. This keeps a single import operation
 * tenant-scoped and avoids inventing multi-job transactions per row.
 */
import { z } from "zod";
import type { ImportJob, ImportStop } from "@privatefleet/contracts";

export class ImportError extends Error {
  constructor(
    readonly code:
      | "IMPORT_INVALID"
      | "IMPORT_TOO_LARGE"
      | "IMPORT_VALIDATION_FAILED"
      | "IMPORT_DUPLICATES",
    message: string = code,
  ) {
    super(message);
  }
}

export interface ImportServiceArea {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface ImportCandidateStop {
  row: number;
  stopType: ImportStop["stopType"];
  address: string;
  latitude: number | null;
  longitude: number | null;
  windowStart: string;
  windowEnd: string;
}

export interface ImportCandidate {
  firstRow: number;
  jobRef: string;
  serviceType: string;
  priority: ImportJob["priority"];
  stops: ImportCandidateStop[];
  errors: string[];
}

const REQUIRED_HEADERS = ["job_ref", "address", "latitude", "longitude"] as const;
const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 5_000;

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/** RFC4180-style parser for quoted commas, escaped quotes and CRLF. */
export function parseCsv(text: string): string[][] {
  if (Buffer.byteLength(text, "utf8") > MAX_CSV_BYTES) {
    throw new ImportError("IMPORT_TOO_LARGE", "CSV exceeds 2 MiB");
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (quoted) {
    throw new ImportError("IMPORT_INVALID", "CSV has an unterminated quoted field");
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseDate(value: string, fallback: string): string | null {
  if (!value.trim()) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildImportCandidates(csv: string): ImportCandidate[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) {
    throw new ImportError("IMPORT_INVALID", "CSV must contain a header and at least one row");
  }
  if (rows.length - 1 > MAX_ROWS) {
    throw new ImportError("IMPORT_TOO_LARGE", `CSV exceeds ${MAX_ROWS} rows`);
  }
  const header = rows[0]!.map(normalizeHeader);
  for (const required of REQUIRED_HEADERS) {
    if (!header.includes(required)) {
      throw new ImportError("IMPORT_INVALID", `Missing required column: ${required}`);
    }
  }
  if (new Set(header).size !== header.length) {
    throw new ImportError("IMPORT_INVALID", "CSV has duplicate column names");
  }
  const index = new Map(header.map((name, i) => [name, i]));
  const value = (row: string[], name: string): string => {
    const i = index.get(name);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const groups = new Map<string, ImportCandidate>();
  for (let r = 1; r < rows.length; r += 1) {
    const raw = rows[r]!;
    if (raw.every((cell) => cell.trim() === "")) continue;
    const rowNumber = r + 1;
    const jobRef = value(raw, "job_ref");
    if (!jobRef) {
      throw new ImportError("IMPORT_INVALID", `Row ${rowNumber}: job_ref is required`);
    }
    if (jobRef.length > 80) {
      throw new ImportError("IMPORT_INVALID", `Row ${rowNumber}: job_ref is too long`);
    }
    const stopTypeRaw = (value(raw, "stop_type") || "dropoff").toLowerCase();
    const stopType = ["pickup", "dropoff", "waypoint"].includes(stopTypeRaw)
      ? (stopTypeRaw as ImportCandidateStop["stopType"])
      : null;
    const address = value(raw, "address");
    const latitude = parseNumber(value(raw, "latitude"));
    const longitude = parseNumber(value(raw, "longitude"));
    const now = new Date();
    const defaultStart = now.toISOString();
    const defaultEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const windowStart = parseDate(value(raw, "window_start"), defaultStart);
    const windowEnd = parseDate(value(raw, "window_end"), defaultEnd);

    const priorityRaw = (value(raw, "priority") || "standard").toLowerCase();
    const serviceType = value(raw, "service_type") || "Delivery";
    const priority = ["standard", "urgent", "stat"].includes(priorityRaw)
      ? (priorityRaw as ImportJob["priority"])
      : null;

    let candidate = groups.get(jobRef);
    if (!candidate) {
      candidate = {
        firstRow: rowNumber,
        jobRef,
        serviceType,
        priority: priority ?? "standard",
        stops: [],
        errors: [],
      };
      groups.set(jobRef, candidate);
    } else if (candidate.serviceType !== serviceType || candidate.priority !== (priority ?? "standard")) {
      candidate.errors.push(`Row ${rowNumber}: service_type/priority must be consistent per job_ref`);
    }

    if (!stopType) candidate.errors.push(`Row ${rowNumber}: invalid stop_type`);
    if (!address) candidate.errors.push(`Row ${rowNumber}: address is required`);
    if (address.length > 300) candidate.errors.push(`Row ${rowNumber}: address is too long`);
    if (latitude === null || latitude < -90 || latitude > 90) {
      candidate.errors.push(`Row ${rowNumber}: latitude must be between -90 and 90`);
    }
    if (longitude === null || longitude < -180 || longitude > 180) {
      candidate.errors.push(`Row ${rowNumber}: longitude must be between -180 and 180`);
    }
    if (!priority) candidate.errors.push(`Row ${rowNumber}: priority must be standard, urgent or stat`);
    if (!windowStart || !windowEnd) {
      candidate.errors.push(`Row ${rowNumber}: window times must be valid dates`);
    }

    candidate.stops.push({
      row: rowNumber,
      stopType: stopType ?? "dropoff",
      address,
      latitude,
      longitude,
      windowStart: windowStart ?? defaultStart,
      windowEnd: windowEnd ?? defaultEnd,
    });
  }

  if (groups.size === 0) {
    throw new ImportError("IMPORT_INVALID", "CSV has no data rows");
  }
  for (const candidate of groups.values()) {
    if (candidate.stops.length > 20) {
      candidate.errors.push(`Maximum 20 stops per job_ref`);
    }
  }
  return [...groups.values()];
}

export function candidateToJob(candidate: ImportCandidate): ImportJob {
  return {
    jobRef: candidate.jobRef,
    serviceType: candidate.serviceType,
    priority: candidate.priority,
    stops: candidate.stops.map((stop, i) => ({
      sequenceNo: i + 1,
      stopType: stop.stopType,
      address: stop.address,
      latitude: stop.latitude!,
      longitude: stop.longitude!,
      windowStart: stop.windowStart,
      windowEnd: stop.windowEnd,
    })),
  };
}

/** Structural validation for the commit payload, independent of CSV. */
export function validateImportJobs(jobs: unknown): ImportJob[] {
  const parsed = z
    .array(
      z.object({
        jobRef: z.string().min(1).max(80),
        serviceType: z.string().min(1).max(80),
        priority: z.enum(["standard", "urgent", "stat"]),
        stops: z
          .array(
            z.object({
              sequenceNo: z.number().int().positive(),
              stopType: z.enum(["pickup", "dropoff", "waypoint"]),
              address: z.string().min(1).max(300),
              latitude: z.number().min(-90).max(90),
              longitude: z.number().min(-180).max(180),
              windowStart: z.string().datetime().optional(),
              windowEnd: z.string().datetime().optional(),
            }),
          )
          .min(1)
          .max(20),
      }),
    )
    .min(1)
    .max(5_000)
    .parse(jobs);
  for (const job of parsed) {
    if (new Set(job.stops.map((stop) => stop.sequenceNo)).size !== job.stops.length) {
      throw new ImportError("IMPORT_VALIDATION_FAILED", "Stop sequence numbers must be unique");
    }
  }
  return parsed;
}
