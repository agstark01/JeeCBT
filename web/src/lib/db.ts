import Dexie, { type EntityTable } from "dexie";
import type { PaperPackage } from "../types";

class JeeCbtLocalDatabase extends Dexie {
  paperPackages!: EntityTable<PaperPackage, "id">;

  constructor() {
    super("jeecbt-local");
    this.version(1).stores({
      paperPackages: "id, ownerId, createdAt, [ownerId+createdAt]",
    });
  }
}

export const localDb = new JeeCbtLocalDatabase();

export async function savePaperPackage(record: PaperPackage): Promise<void> {
  await localDb.paperPackages.put(record);
}

export async function listPaperPackages(ownerId: string): Promise<PaperPackage[]> {
  const records = await localDb.paperPackages.where("ownerId").equals(ownerId).toArray();
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deletePaperPackage(id: string, ownerId: string): Promise<void> {
  const record = await localDb.paperPackages.get(id);
  if (record?.ownerId === ownerId) {
    await localDb.paperPackages.delete(id);
  }
}

export async function clearLocalData(ownerId: string): Promise<void> {
  await localDb.paperPackages.where("ownerId").equals(ownerId).delete();
}
