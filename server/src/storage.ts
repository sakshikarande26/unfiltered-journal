import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

/**
 * Photo bytes. The database only ever holds `storage_path`; this interface is
 * the whole difference between local dev (a directory) and production
 * (Supabase Storage REST), so the API code never cares which it is.
 */
export interface Storage {
  put(path: string, bytes: Buffer, contentType: string): Promise<void>;
  get(path: string): Promise<Buffer | null>;
}

/** Local dev: a plain directory under the server's data root. */
export class FsStorage implements Storage {
  constructor(private readonly root: string) {}

  async put(path: string, bytes: Buffer): Promise<void> {
    const dest = join(this.root, normalize(path));
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
  }

  async get(path: string): Promise<Buffer | null> {
    const dest = join(this.root, normalize(path));
    if (!existsSync(dest)) return null;
    return readFile(dest);
  }
}

/**
 * Production: a private Supabase Storage bucket, driven over the Storage REST
 * API with the project's service-role key.
 */
export class SupabaseRestStorage implements Storage {
  constructor(
    private readonly supabaseUrl: string,
    private readonly serviceKey: string,
    private readonly bucket: string,
  ) {}

  private objectUrl(path: string, authenticated: boolean): string {
    const base = authenticated
      ? `${this.supabaseUrl}/storage/v1/object/authenticated`
      : `${this.supabaseUrl}/storage/v1/object`;
    return `${base}/${this.bucket}/${path}`;
  }

  async put(path: string, bytes: Buffer, contentType: string): Promise<void> {
    const res = await fetch(this.objectUrl(path, false), {
      method: "PUT",
      headers: {
        authorization: `Bearer ${this.serviceKey}`,
        "content-type": contentType,
        "x-upsert": "true",
      },
      body: new Uint8Array(bytes),
    });
    if (!res.ok) {
      throw new Error(`storage put ${path} -> ${res.status}`);
    }
  }

  async get(path: string): Promise<Buffer | null> {
    const res = await fetch(this.objectUrl(path, true), {
      headers: { authorization: `Bearer ${this.serviceKey}` },
    });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) {
      throw new Error(`storage get ${path} -> ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
