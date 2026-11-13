import Dexie, { type EntityTable } from "dexie";
import type { ExamAttempt, PaperPackage } from "../types";

class JeeCbtLocalDatabase extends Dexie {
  paperPackages!: EntityTable<PaperPackage, "id">;
  testAttempts!: EntityTable<ExamAttempt, "id">;

  constructor() {
    super("jeecbt-local");
    this.version(1).stores({
      paperPackages: "id, ownerId, createdAt, [ownerId+createdAt]",
    });
    this.version(2).stores({
      paperPackages: "id, ownerId, createdAt, [ownerId+createdAt]",
      testAttempts: "id, ownerId, createdAt, [ownerId+createdAt]",
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
  await localDb.transaction("rw", localDb.paperPackages, localDb.testAttempts, async () => {
    await localDb.paperPackages.where("ownerId").equals(ownerId).delete();
    await localDb.testAttempts.where("ownerId").equals(ownerId).delete();
  });
}

export async function moveGuestPackagesToAccount(ownerId: string): Promise<void> {
  if (!ownerId || ownerId === "local") return;
  await localDb.transaction("rw", localDb.paperPackages, localDb.testAttempts, async () => {
    const guestPackages = await localDb.paperPackages.where("ownerId").equals("local").toArray();
    const guestAttempts = await localDb.testAttempts.where("ownerId").equals("local").toArray();
    for (const record of guestPackages) {
      record.ownerId = ownerId;
      await localDb.paperPackages.put(record);
    }
    for (const attempt of guestAttempts) {
      attempt.ownerId = ownerId;
      await localDb.testAttempts.put(attempt);
    }
  });
}

export async function saveExamAttempt(attempt: ExamAttempt): Promise<void> {
  await localDb.testAttempts.put(attempt);
}

export async function listExamAttempts(ownerId: string): Promise<ExamAttempt[]> {
  const attempts = await localDb.testAttempts.where("ownerId").equals(ownerId).toArray();
  return attempts.sort((left, right) => right.createdAt - left.createdAt);
}
