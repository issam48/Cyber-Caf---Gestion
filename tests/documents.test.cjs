const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("../dist/main/electron/database.js");
const { BusinessService } = require("../dist/main/electron/service.js");
const { createAutomaticBackup, createBackupFolder, restoreDatabaseBackup, verifyBackup } = require("../dist/main/electron/backup.js");

const temporaryFolders = [];
const openContexts = [];
afterEach(() => {
  for (const context of openContexts.splice(0)) {
    if (context.db.open) context.db.close();
  }
  for (const folder of temporaryFolders.splice(0)) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

function setup() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "cafe-documents-"));
  temporaryFolders.push(folder);
  const context = openDatabase(folder);
  openContexts.push(context);
  const service = new BusinessService(context);
  service.saveBusinessSettings({
    name: "Café de test", address: "Alger", phone: "0550000000", email: "", website: "",
    rc: "", nif: "", nis: "", ai: "", bank_info: "", footer: "Merci",
    logo_path: "", signature_path: "",
  });
  return { context, service };
}

function draft(type, overrides = {}) {
  return {
    type, customer_id: null, related_document_id: null,
    customer: { name: "ليلى بن صالح", address: "الجزائر", phone: "0550", email: "", nif: "", notes: "" },
    issue_date: "2026-05-01", due_date: "", validity_days: null, payment_terms: "Espèces",
    notes: "", items: [{ description: "Service internet", quantity: 2, unit_price: 100, discount: 0, tax_rate: null }],
    issue_now: true, ...overrides,
  };
}

test("issues sequential unique invoice numbers and cancellation never reuses a number", () => {
  const { service, context } = setup();
  const first = service.saveDocument(draft("INVOICE"));
  const second = service.saveDocument(draft("INVOICE"));
  assert.equal(first.number, "FAC-2026-0001");
  assert.equal(second.number, "FAC-2026-0002");
  service.cancelDocument(first.id, "Erreur de saisie");
  const third = service.saveDocument(draft("INVOICE"));
  assert.equal(third.number, "FAC-2026-0003");
  assert.equal(context.db.prepare("SELECT COUNT(*) AS count FROM document_numbering_history").get().count, 3);
});

test("proforma conversion is one-time, keeps its original snapshot and copies line tax values", () => {
  const { service } = setup();
  service.saveTaxSettings({ enabled: true, default_rate: 9, price_mode: "HT" });
  const proforma = service.saveDocument(draft("PROFORMA", {
    items: [{ description: "Service", quantity: 3, unit_price: 125, discount: 4, tax_rate: 7 }],
  }));
  const oldSnapshot = proforma.business_snapshot;
  const oldItem = proforma.items[0];
  service.saveBusinessSettings({
    ...service.getBusinessSettings(), name: "Nom modifié",
  });
  const invoice = service.convertProforma(proforma.id);
  const updatedProforma = service.getDocument(proforma.id);
  assert.equal(invoice.number, "FAC-2026-0001");
  assert.equal(invoice.items[0].quantity, oldItem.quantity);
  assert.equal(invoice.items[0].unit_price, oldItem.unit_price);
  assert.equal(invoice.items[0].tax_rate, oldItem.tax_rate);
  assert.equal(invoice.items[0].line_ht, oldItem.line_ht);
  assert.equal(invoice.items[0].tax_amount, oldItem.tax_amount);
  assert.equal(invoice.business_snapshot, oldSnapshot);
  assert.equal(updatedProforma.business_snapshot, oldSnapshot);
  assert.equal(updatedProforma.status, "CONVERTED");
  assert.throws(() => service.convertProforma(proforma.id), /مسبقاً/);
});

test("TVA is optional and historical calculations remain unchanged after settings change", () => {
  const { service } = setup();
  const withoutTax = service.saveDocument(draft("INVOICE"));
  assert.equal(withoutTax.total_tax, 0);
  assert.equal(withoutTax.total_ttc, 200);
  service.saveTaxSettings({ enabled: true, default_rate: 10, price_mode: "HT" });
  const withTax = service.saveDocument(draft("INVOICE"));
  assert.equal(withTax.subtotal_ht, 200);
  assert.equal(withTax.total_tax, 20);
  assert.equal(withTax.total_ttc, 220);
  service.saveTaxSettings({ enabled: false, default_rate: null, price_mode: "TTC" });
  assert.equal(service.getDocument(withTax.id).total_tax, 20);
  assert.equal(service.saveDocument(draft("INVOICE")).total_tax, 0);
});

test("drafts do not consume numbers; official issuance validates shop settings", () => {
  const { service } = setup();
  const saved = service.saveDocument(draft("INVOICE", { issue_now: false }));
  assert.equal(saved.number, null);
  const issued = service.issueDocument(saved.id);
  assert.equal(issued.number, "FAC-2026-0001");
});

test("payment creates a receipt and updates invoice balance transactionally", () => {
  const { service } = setup();
  const invoice = service.saveDocument(draft("INVOICE"));
  const updated = service.addPayment({ invoice_id: invoice.id, amount: 75, method: "Espèces", date: "2026-05-02" });
  assert.equal(updated.paid_amount, 75);
  assert.equal(updated.balance, 125);
  const receipts = service.listDocuments({ search: "", type: "RECEIPT", status: "", from: "", to: "" });
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].number, "REC-2026-0001");
  assert.throws(() => service.addPayment({ invoice_id: invoice.id, amount: 126, method: "Espèces", date: "2026-05-02" }), /يتجاوز/);
  assert.throws(() => service.duplicateDocument(receipts[0].id), /لا يمكن نسخ إيصال/);
  service.cancelDocument(updated.id, "Erreur de facturation");
  assert.equal(service.getDocument(updated.id).status, "CANCELLED");
});

test("credit notes require an issued invoice and remain navigable as related records", () => {
  const { service } = setup();
  const invoice = service.saveDocument(draft("INVOICE"));
  const creditNote = service.saveDocument(draft("CREDIT_NOTE", {
    related_document_id: invoice.id,
    notes: "Correction d'un article",
    items: [{ description: "Correction", quantity: 1, unit_price: 25, discount: 0, tax_rate: null }],
  }));
  assert.equal(creditNote.number, "AV-2026-0001");
  assert.equal(service.getRelatedDocuments(invoice.id)[0].id, creditNote.id);
  assert.equal(service.getRelatedDocuments(creditNote.id)[0].id, invoice.id);
  assert.throws(() => service.saveDocument(draft("CREDIT_NOTE")), /فاتورة مرتبطة/);
});

test("document archive supports amount range filters", () => {
  const { service } = setup();
  service.saveDocument(draft("INVOICE"));
  service.saveDocument(draft("INVOICE", {
    items: [{ description: "Forfait", quantity: 1, unit_price: 500, discount: 0, tax_rate: null }],
  }));
  const result = service.listDocuments({
    search: "", type: "", status: "", from: "", to: "", min_amount: "300", max_amount: "600",
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].total_ttc, 500);
});

test("Word files are stored locally, renamed and copied back with their original content", () => {
  const { service, context } = setup();
  const source = path.join(context.userDataPath, "original.docx");
  fs.writeFileSync(source, "word document bytes");
  const uploaded = service.addWordFile(source, "نموذج تسجيل");
  assert.equal(uploaded.display_name, "نموذج تسجيل");
  assert.equal(uploaded.extension, ".docx");
  assert.equal(service.listWordFiles("تسجيل").length, 1);
  const renamed = service.renameWordFile(uploaded.id, "استمارة العميل");
  assert.equal(renamed.display_name, "استمارة العميل");
  const download = path.join(context.userDataPath, "downloaded.docx");
  service.copyWordFile(uploaded.id, download);
  assert.equal(fs.readFileSync(download, "utf8"), "word document bytes");
  const unsupported = path.join(context.userDataPath, "unsupported.pdf");
  fs.writeFileSync(unsupported, "not a Word file");
  assert.throws(() => service.addWordFile(unsupported, "غير مدعوم"), /DOC وDOCX/);
});

test("backup contains persistent SQLite data and passes integrity verification", () => {
  const { service, context } = setup();
  service.saveDocument(draft("INVOICE"));
  fs.writeFileSync(path.join(context.attachmentsPath, "logo.png"), Buffer.from("local attachment"));
  const wordSource = path.join(context.userDataPath, "backup.docx");
  fs.writeFileSync(wordSource, "backup word content");
  service.addWordFile(wordSource, "ملف محفوظ");
  const target = path.join(context.userDataPath, "backup-test");
  createBackupFolder(context, target);
  verifyBackup(target);
  const backupDb = require("better-sqlite3");
  const restored = new backupDb(path.join(target, "business.sqlite"), { readonly: true });
  assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM documents").get().count, 1);
  assert.equal(restored.pragma("integrity_check", { simple: true }), "ok");
  restored.close();
  assert.equal(fs.readFileSync(path.join(target, "attachments", "logo.png"), "utf8"), "local attachment");
  assert.equal(createAutomaticBackup(context), path.join(context.userDataPath, "automatic-backups", `backup-${new Date().toISOString().slice(0, 10)}`));
  assert.equal(createAutomaticBackup(context), null);
  service.saveDocument(draft("INVOICE"));
  fs.writeFileSync(path.join(context.attachmentsPath, "logo.png"), "newer attachment");
  const restoredContext = restoreDatabaseBackup(context, target);
  openContexts.push(restoredContext);
  const restoredService = new BusinessService(restoredContext);
  assert.equal(restoredService.listDocuments({ search: "", type: "", status: "", from: "", to: "" }).length, 1);
  assert.equal(fs.readFileSync(path.join(restoredContext.attachmentsPath, "logo.png"), "utf8"), "local attachment");
  const restoredWordFile = restoredService.listWordFiles("ملف محفوظ")[0];
  const restoredWordPath = path.join(restoredContext.userDataPath, "restored.docx");
  restoredService.copyWordFile(restoredWordFile.id, restoredWordPath);
  assert.equal(fs.readFileSync(restoredWordPath, "utf8"), "backup word content");
});
