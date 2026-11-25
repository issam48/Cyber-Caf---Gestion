import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { openDatabase, type DatabaseContext } from "./database";

export function verifyBackup(folder: string): void {
  const manifestPath = path.join(folder, "manifest.json");
  const databasePath = path.join(folder, "business.sqlite");
  const attachmentsPath = path.join(folder, "attachments");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { version?: number };
  if (manifest.version !== 1 || !fs.existsSync(databasePath) || !fs.existsSync(attachmentsPath)) {
    throw new Error("مجلد النسخة الاحتياطية غير صالح أو غير مكتمل.");
  }
  const database = new Database(databasePath, { readonly: true });
  try {
    const integrity = database.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error("قاعدة البيانات في النسخة الاحتياطية تالفة.");
  } finally {
    database.close();
  }
}

export function createBackupFolder(context: DatabaseContext, target: string): string {
  if (fs.existsSync(target)) throw new Error("مجلد النسخة الاحتياطية موجود مسبقاً.");
  context.db.pragma("wal_checkpoint(FULL)");
  fs.mkdirSync(path.join(target, "attachments"), { recursive: true });
  try {
    fs.copyFileSync(context.databasePath, path.join(target, "business.sqlite"));
    fs.cpSync(context.attachmentsPath, path.join(target, "attachments"), { recursive: true });
    fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify({
      version: 1,
      created_at: new Date().toISOString(),
      database: "business.sqlite",
      attachments: "attachments",
    }, null, 2), "utf8");
    verifyBackup(target);
    return target;
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

export function createAutomaticBackup(context: DatabaseContext): string | null {
  const parent = path.join(context.userDataPath, "automatic-backups");
  fs.mkdirSync(parent, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const name = `backup-${day}`;
  const target = path.join(parent, name);
  if (fs.existsSync(target)) {
    verifyBackup(target);
    return null;
  }
  const created = createBackupFolder(context, target);
  const oldFolders = fs.readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^backup-\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .slice(0, -14);
  for (const oldFolder of oldFolders) {
    fs.rmSync(path.join(parent, oldFolder), { recursive: true, force: true });
  }
  return created;
}

export function restoreDatabaseBackup(context: DatabaseContext, folder: string): DatabaseContext {
  verifyBackup(folder);
  const stage = path.join(context.userDataPath, `.restore-${Date.now()}`);
  const stagedDatabase = path.join(stage, "business.sqlite");
  const stagedAttachments = path.join(stage, "attachments");
  const previousDatabase = path.join(stage, "previous.sqlite");
  const previousAttachments = path.join(stage, "previous-attachments");
  fs.mkdirSync(stagedAttachments, { recursive: true });
  fs.copyFileSync(path.join(folder, "business.sqlite"), stagedDatabase);
  fs.cpSync(path.join(folder, "attachments"), stagedAttachments, { recursive: true });
  fs.copyFileSync(path.join(folder, "manifest.json"), path.join(stage, "manifest.json"));
  verifyBackup(stage);

  let oldDatabaseMoved = false;
  let oldAttachmentsMoved = false;
  let newDatabaseMoved = false;
  let newAttachmentsMoved = false;
  context.db.close();
  try {
    fs.renameSync(context.databasePath, previousDatabase);
    oldDatabaseMoved = true;
    fs.renameSync(context.attachmentsPath, previousAttachments);
    oldAttachmentsMoved = true;
    fs.renameSync(stagedDatabase, context.databasePath);
    newDatabaseMoved = true;
    fs.renameSync(stagedAttachments, context.attachmentsPath);
    newAttachmentsMoved = true;
    return openDatabase(context.userDataPath);
  } catch (error) {
    if (newAttachmentsMoved) fs.rmSync(context.attachmentsPath, { recursive: true, force: true });
    if (newDatabaseMoved) fs.rmSync(context.databasePath, { force: true });
    if (oldDatabaseMoved) fs.renameSync(previousDatabase, context.databasePath);
    if (oldAttachmentsMoved) fs.renameSync(previousAttachments, context.attachmentsPath);
    throw error;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
