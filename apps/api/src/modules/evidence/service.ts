/**
 * Proof-of-delivery evidence: policy, validation, private storage and
 * tenant-scoped retrieval. Metadata is authoritative in PostgreSQL; media
 * bytes live only in EvidenceStore.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  EvidenceKind,
  ProofPolicy,
  StopEvidenceDto,
} from "@privatefleet/contracts";
import { withTenant, type DbHandle } from "../../db/client.js";
import type { EvidenceStore } from "./storage.js";

const MAX_SIGNATURE_BYTES = 512 * 1024;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const WEBP = Buffer.from("RIFF");

export class EvidenceError extends Error {
  constructor(
    readonly code:
      | "EVIDENCE_INVALID"
      | "EVIDENCE_TOO_LARGE"
      | "EVIDENCE_REQUIRED"
      | "EVIDENCE_ALREADY_RECORDED"
      | "EVIDENCE_NOT_FOUND"
      | "EVIDENCE_STORAGE_FAILED"
      | "STOP_NOT_FOUND"
      | "STOP_NOT_ASSIGNED_TO_DRIVER",
    message: string = code,
  ) {
    super(message);
  }
}

export interface EvidenceInput {
  kind: EvidenceKind;
  dataBase64?: string | undefined;
  pathData?: string | undefined;
  capturedAt?: string | undefined;
}

interface StopContext {
  stop_id: string;
  status: string;
  address: string;
  job_id: string;
  service_type: string;
  assigned_driver_id: string | null;
}

type PolicyRow = {
  require_recipient: boolean;
  require_signature: boolean;
  require_photo: boolean;
  require_failure_photo: boolean;
};

const DEFAULT_POLICY: PolicyRow = {
  require_recipient: true,
  require_signature: false,
  require_photo: false,
  require_failure_photo: false,
};

function detectMedia(bytes: Buffer, kind: EvidenceKind): {
  extension: "png" | "jpg" | "webp" | "svg";
  mimeType: string;
} {
  if (bytes.subarray(0, PNG.length).equals(PNG)) return { extension: "png", mimeType: "image/png" };
  if (bytes.subarray(0, JPEG.length).equals(JPEG)) return { extension: "jpg", mimeType: "image/jpeg" };
  if (
    bytes.subarray(0, 4).equals(WEBP) &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { extension: "webp", mimeType: "image/webp" };
  }
  if (kind === "signature" && bytes.subarray(0, 5).toString("ascii") === "<svg ") {
    return { extension: "svg", mimeType: "image/svg+xml" };
  }
  throw new EvidenceError("EVIDENCE_INVALID", "Unsupported or spoofed media content");
}

function buildSignatureSvg(pathData: string): Buffer {
  // Signature paths are captured as simple SVG line commands. Reject any
  // markup, scripts or characters outside the path grammar.
  if (!/^[ML0-9\s.,-]+$/.test(pathData) || pathData.length > 20_000) {
    throw new EvidenceError("EVIDENCE_INVALID", "Invalid signature path");
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="260" viewBox="0 0 720 260"><rect width="720" height="260" fill="#ffffff"/><path d="${pathData}" fill="none" stroke="#171816" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return Buffer.from(svg, "utf8");
}

export class EvidenceService {
  constructor(
    private readonly handle: DbHandle,
    private readonly store: EvidenceStore,
  ) {}

  async policy(tenantId: string, serviceType: string): Promise<ProofPolicy> {
    return withTenant(this.handle, tenantId, async (db) => {
      const rows = (await db.execute(
        sql`SELECT service_type, require_recipient, require_signature, require_photo,
                   require_failure_photo
            FROM proof_policies
            WHERE tenant_id = ${tenantId} AND service_type IN (${serviceType}, '*')
            ORDER BY CASE WHEN service_type = ${serviceType} THEN 0 ELSE 1 END
            LIMIT 1`,
      )) as unknown as Array<PolicyRow & { service_type: string }>;
      const row = rows[0] ?? { ...DEFAULT_POLICY, service_type: "*" };
      return {
        serviceType: row.service_type,
        requireRecipient: row.require_recipient,
        requireSignature: row.require_signature,
        requirePhoto: row.require_photo,
        requireFailurePhoto: row.require_failure_photo,
      };
    });
  }

  async setPolicy(
    tenantId: string,
    serviceType: string,
    policy: Omit<ProofPolicy, "serviceType">,
  ): Promise<ProofPolicy> {
    return withTenant(this.handle, tenantId, async (db) => {
      await db.execute(sql`
        INSERT INTO proof_policies
          (tenant_id, service_type, require_recipient, require_signature, require_photo, require_failure_photo, updated_at)
        VALUES
          (${tenantId}, ${serviceType}, ${policy.requireRecipient}, ${policy.requireSignature},
           ${policy.requirePhoto}, ${policy.requireFailurePhoto}, now())
        ON CONFLICT (tenant_id, service_type) DO UPDATE SET
          require_recipient = EXCLUDED.require_recipient,
          require_signature = EXCLUDED.require_signature,
          require_photo = EXCLUDED.require_photo,
          require_failure_photo = EXCLUDED.require_failure_photo,
          updated_at = now()
      `);
      return { serviceType, ...policy };
    });
  }

  async record(
    tenantId: string,
    actorId: string,
    driverId: string,
    jobId: string,
    stopId: string,
    input: EvidenceInput,
  ): Promise<StopEvidenceDto> {
    return withTenant(this.handle, tenantId, async (db) => {
      const stops = (await db.execute(
        sql`SELECT s.id AS stop_id, s.status, s.address, s.job_id, j.service_type,
                   j.assigned_driver_id
            FROM job_stops s JOIN jobs j ON j.id = s.job_id
            WHERE s.id = ${stopId} AND s.job_id = ${jobId}`,
      )) as unknown as StopContext[];
      const stop = stops[0];
      if (!stop) throw new EvidenceError("STOP_NOT_FOUND");
      if (stop.assigned_driver_id !== driverId) {
        throw new EvidenceError("STOP_NOT_ASSIGNED_TO_DRIVER");
      }
      if (stop.status === "completed" || stop.status === "skipped") {
        throw new EvidenceError("EVIDENCE_INVALID", "Stop is already complete");
      }

      let bytes: Buffer;
      if (input.kind === "signature" && input.pathData) {
        bytes = buildSignatureSvg(input.pathData);
      } else if (input.dataBase64) {
        try {
          bytes = Buffer.from(input.dataBase64, "base64");
        } catch {
          throw new EvidenceError("EVIDENCE_INVALID", "Invalid base64 evidence");
        }
      } else {
        throw new EvidenceError("EVIDENCE_INVALID", "Evidence bytes are required");
      }

      const max = input.kind === "signature" ? MAX_SIGNATURE_BYTES : MAX_PHOTO_BYTES;
      if (bytes.length === 0 || bytes.length > max) {
        throw new EvidenceError("EVIDENCE_TOO_LARGE", "Evidence exceeds the allowed size");
      }
      const media = detectMedia(bytes, input.kind);

      const existing = (await db.execute(
        sql`SELECT id, kind, mime_type, byte_size, content_hash, captured_at, uploaded_by
            FROM stop_evidence WHERE stop_id = ${stopId} AND kind = ${input.kind}
            LIMIT 1`,
      )) as unknown as Array<{
        id: string;
        kind: EvidenceKind;
        mime_type: string;
        byte_size: number;
        content_hash: string;
        captured_at: Date | string | null;
        uploaded_by: string | null;
      }>;
      if (existing[0]) {
        if (existing[0].content_hash === this.hash(bytes)) {
          return this.toDto(existing[0]);
        }
        throw new EvidenceError(
          "EVIDENCE_ALREADY_RECORDED",
          "A different piece of evidence is already recorded for this stop",
        );
      }

      const stored = await this.store.put(tenantId, stopId, media.extension, bytes);
      try {
        const rows = (await db.execute(
          sql`INSERT INTO stop_evidence
                (tenant_id, job_id, stop_id, kind, storage_key, content_hash, mime_type,
                 byte_size, captured_at, uploaded_by)
              VALUES (${tenantId}, ${jobId}, ${stopId}, ${input.kind}, ${stored.storageKey},
                ${stored.contentHash}, ${media.mimeType}, ${stored.byteSize},
                ${input.capturedAt ?? new Date().toISOString()}, ${actorId})
              RETURNING id, kind, mime_type, byte_size, content_hash, captured_at, uploaded_by`,
        )) as unknown as Array<{
          id: string;
          kind: EvidenceKind;
          mime_type: string;
          byte_size: number;
          content_hash: string;
          captured_at: Date | string | null;
          uploaded_by: string | null;
        }>;
        return this.toDto(rows[0]!);
      } catch (error) {
        await this.store.remove(stored.storageKey);
        if (error instanceof EvidenceError) throw error;
        throw new EvidenceError("EVIDENCE_STORAGE_FAILED", "Evidence could not be recorded");
      }
    });
  }

  async list(
    tenantId: string,
    jobId: string,
    stopId: string,
    includeData: boolean,
    viewer?: { role: string; userId: string },
  ): Promise<StopEvidenceDto[]> {
    return withTenant(this.handle, tenantId, async (db) => {
      if (viewer?.role === "driver") {
        const access = (await db.execute(
          sql`SELECT 1 FROM job_stops s JOIN jobs j ON j.id = s.job_id
              WHERE s.id = ${stopId} AND s.job_id = ${jobId} AND j.assigned_driver_id = ${viewer.userId}`,
        )) as unknown as Array<unknown>;
        if (access.length === 0) {
          throw new EvidenceError("STOP_NOT_ASSIGNED_TO_DRIVER");
        }
      }
      const rows = (await db.execute(
        sql`SELECT id, kind, mime_type, byte_size, content_hash, captured_at, uploaded_by, storage_key
            FROM stop_evidence WHERE job_id = ${jobId} AND stop_id = ${stopId}
            ORDER BY created_at`,
      )) as unknown as Array<{
        id: string;
        kind: EvidenceKind;
        mime_type: string;
        byte_size: number;
        content_hash: string;
        captured_at: Date | string | null;
        uploaded_by: string | null;
        storage_key: string;
      }>;
      const output: StopEvidenceDto[] = [];
      for (const row of rows) {
        const dto = this.toDto(row);
        if (includeData) {
          try {
            dto.dataBase64 = (await this.store.read(row.storage_key)).toString("base64");
          } catch {
            throw new EvidenceError("EVIDENCE_NOT_FOUND", "Evidence file is missing");
          }
        }
        output.push(dto);
      }
      return output;
    });
  }

  async evidenceKinds(tenantId: string, stopId: string): Promise<Set<EvidenceKind>> {
    return withTenant(this.handle, tenantId, async (db) => {
      const rows = (await db.execute(
        sql`SELECT kind FROM stop_evidence WHERE stop_id = ${stopId}`,
      )) as unknown as Array<{ kind: EvidenceKind }>;
      return new Set(rows.map((row) => row.kind));
    });
  }

  private hash(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  private toDto(row: {
    id: string;
    kind: EvidenceKind;
    mime_type: string;
    byte_size: number;
    content_hash: string;
    captured_at: Date | string | null;
    uploaded_by: string | null;
  }): StopEvidenceDto {
    return {
      id: row.id,
      kind: row.kind,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      contentHash: row.content_hash,
      ...(row.captured_at ? { capturedAt: new Date(row.captured_at).toISOString() } : {}),
      ...(row.uploaded_by ? { uploadedBy: row.uploaded_by } : {}),
    };
  }
}


