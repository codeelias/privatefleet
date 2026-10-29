/**
 * Private evidence store (no public web root, no object-storage dependency).
 * Keys are server-generated; callers never supply paths.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type StoredEvidence = {
  storageKey: string;
  contentHash: string;
  byteSize: number;
};

const SAFE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp|svg)$/;

export class EvidenceStore {
  constructor(private readonly root: string) {}

  async put(
    tenantId: string,
    stopId: string,
    extension: "png" | "jpg" | "webp" | "svg",
    bytes: Buffer,
  ): Promise<StoredEvidence> {
    const storageKey = `${tenantId}/${stopId}/${randomUUID()}.${extension}`;
    const fullPath = this.pathFor(storageKey);
    await mkdir(dirname(fullPath), { recursive: true });
    const tempPath = `${fullPath}.tmp`;
    await writeFile(tempPath, bytes, { flag: "wx" });
    await rename(tempPath, fullPath);
    return {
      storageKey,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.length,
    };
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.pathFor(storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    try {
      await unlink(this.pathFor(storageKey));
    } catch {
      // Missing file is already the desired state.
    }
  }

  private pathFor(storageKey: string): string {
    if (!SAFE_KEY.test(storageKey)) {
      throw new Error("invalid evidence storage key");
    }
    return join(this.root, ...storageKey.split("/"));
  }
}
