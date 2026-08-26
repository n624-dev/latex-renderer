import type { DatabaseSync } from "node:sqlite";

export interface SettingRow { key: string; value_json: string; updated_by: string; updated_at: string }

export class SettingsRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(key: string): SettingRow | undefined {
    return this.db.prepare("SELECT key,value_json,updated_by,updated_at FROM system_settings WHERE key=?").get(key) as unknown as SettingRow | undefined;
  }

  value<T>(key: string, fallback: T): T {
    const row = this.get(key);
    return row === undefined ? fallback : JSON.parse(row.value_json) as T;
  }

  listMutable(): SettingRow[] {
    return this.db.prepare("SELECT key,value_json,updated_by,updated_at FROM system_settings WHERE key IN ('max_queue_length','max_user_storage_bytes') ORDER BY key").all() as unknown as SettingRow[];
  }

  upsert(key: string, value: unknown, updatedBy: string, timestamp: string): void {
    this.db.prepare(`INSERT INTO system_settings(key,value_json,updated_by,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .run(key,JSON.stringify(value),updatedBy,timestamp);
  }
}
