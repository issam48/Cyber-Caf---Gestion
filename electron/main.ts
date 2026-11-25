import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase, type DatabaseContext } from "./database";
import { createAutomaticBackup, createBackupFolder, restoreDatabaseBackup } from "./backup";
import { BusinessService } from "./service";
import { createWordDocument, type WordDocumentImage } from "./word-export";
import type { BusinessSettings, DocumentRecord } from "../shared/types";

let context: DatabaseContext;
let service: BusinessService;
let mainWindow: BrowserWindow | null = null;
const now = () => new Date().toISOString();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: "#f5f7fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (!app.isPackaged) {
    void mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));
  }
  mainWindow.on("closed", () => { mainWindow = null; });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function imageData(filePath: string): string {
  try {
    const extension = path.extname(filePath).toLowerCase();
    const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
  } catch {
    return "";
  }
}

function renderDocument(document: DocumentRecord): string {
  const business = JSON.parse(document.business_snapshot) as BusinessSettings;
  const customer = JSON.parse(document.customer_snapshot) as { name?: string; address?: string; phone?: string; email?: string; nif?: string };
  const tax = JSON.parse(document.tax_snapshot) as { enabled: boolean };
  const title: Record<string, string> = {
    INVOICE: "FACTURE", PROFORMA: "FACTURE PROFORMA", QUOTE: "DEVIS",
    PURCHASE_ORDER: "BON DE COMMANDE", RECEIPT: "REÇU DE PAIEMENT", CREDIT_NOTE: "AVOIR",
  };
  const rows = (document.items ?? []).map((item) =>
    `<tr><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.quantity)}</td>` +
    `<td>${moneyFormat(item.unit_price)} DZD</td><td>${escapeHtml(item.discount)}%</td>` +
    `<td>${moneyFormat(item.line_ht)} DZD</td>${tax.enabled ? `<td>${item.tax_rate ?? "—"}%<br>${moneyFormat(item.tax_amount)} DZD</td>` : ""}` +
    `<td>${moneyFormat(item.line_ttc)} DZD</td></tr>`).join("");
  const logo = business.logo_path ? `<img class="logo" src="${imageData(business.logo_path)}">` : "";
  const signature = business.signature_path ? `<img class="signature" src="${imageData(business.signature_path)}">` : "";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    @page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,"Noto Naskh Arabic",sans-serif;color:#1b2737;font-size:12px}
    .head{display:flex;justify-content:space-between;border-bottom:3px solid #166f68;padding-bottom:16px}
    .brand{display:flex;gap:14px;align-items:center}.logo{max-width:100px;max-height:72px;object-fit:contain}
    h1{font-size:27px;color:#166f68;margin:18px 0 4px}.muted{color:#64748b;line-height:1.6}
    .number{font-size:16px;font-weight:bold}.row{display:flex;justify-content:space-between;gap:30px;margin:22px 0}
    .box{width:50%;background:#f4f7f8;padding:12px;border-radius:6px;line-height:1.8}
    table{width:100%;border-collapse:collapse;margin:18px 0}th{background:#166f68;color:#fff;text-align:start}
    th,td{border:1px solid #dce4e8;padding:8px;vertical-align:top}td:nth-child(n+2){text-align:end}
    .summary{width:45%;margin-inline-start:auto}.summary td{border:0;border-bottom:1px solid #e6eaed}
    .total{font-weight:bold;font-size:15px;color:#166f68}.foot{border-top:1px solid #ccd5dc;margin-top:40px;padding-top:12px;display:flex;justify-content:space-between}
    .signature{max-width:120px;max-height:75px;object-fit:contain}.arabic{direction:auto;unicode-bidi:plaintext}
    </style></head><body>
    <header class="head"><div class="brand">${logo}<div><strong>${escapeHtml(business.name)}</strong><div class="muted">${escapeHtml(business.address)}<br>${escapeHtml(business.phone)} ${escapeHtml(business.email)}</div></div></div>
    <div class="muted">RC: ${escapeHtml(business.rc)} · NIF: ${escapeHtml(business.nif)}<br>NIS: ${escapeHtml(business.nis)} · AI: ${escapeHtml(business.ai)}</div></header>
    <h1>${title[document.type] ?? "DOCUMENT"}</h1><div class="number">${escapeHtml(document.number ?? "BROUILLON")}</div>
    <div class="row"><section class="box"><strong>Client</strong><br><span class="arabic">${escapeHtml(customer.name)}</span><br>
    <span class="arabic">${escapeHtml(customer.address)}</span><br>${escapeHtml(customer.phone)}<br>${escapeHtml(customer.email)}<br>NIF: ${escapeHtml(customer.nif)}</section>
    <section class="box"><strong>Date:</strong> ${formatDate(document.issue_date)}<br>
    ${document.due_date ? `<strong>Échéance:</strong> ${formatDate(document.due_date)}<br>` : ""}
    ${document.validity_days ? `<strong>Validité:</strong> ${document.validity_days} jours<br>` : ""}
    <strong>Conditions de paiement:</strong> ${escapeHtml(document.payment_terms)}</section></div>
    <table><thead><tr><th>Désignation</th><th>Qté</th><th>Prix unitaire</th><th>Remise</th><th>HT</th>${tax.enabled ? "<th>TVA</th>" : ""}<th>TTC</th></tr></thead><tbody>${rows}</tbody></table>
    <table class="summary"><tbody><tr><td>Total HT</td><td>${moneyFormat(document.subtotal_ht)} DZD</td></tr>
    ${tax.enabled ? `<tr><td>TVA</td><td>${moneyFormat(document.total_tax)} DZD</td></tr>` : ""}
    <tr class="total"><td>Total ${tax.enabled ? "TTC" : ""}</td><td>${moneyFormat(document.total_ttc)} DZD</td></tr>
    ${document.type === "INVOICE" ? `<tr><td>Payé</td><td>${moneyFormat(document.paid_amount)} DZD</td></tr><tr><td>Reste à payer</td><td>${moneyFormat(document.balance)} DZD</td></tr>` : ""}</tbody></table>
    <div>${escapeHtml(document.notes)}</div><footer class="foot"><div>${escapeHtml(business.footer)}<br>${escapeHtml(business.bank_info)}</div><div>Signature et cachet<br>${signature}</div></footer>
    </body></html>`;
}

function moneyFormat(value: number): string {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string): string {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR").format(date);
}

async function printDocument(id: number, exportPdf: boolean): Promise<string | null> {
  const document = service.getDocument(id);
  if (!document) throw new Error("Document introuvable.");
  const printDirectory = fs.mkdtempSync(path.join(app.getPath("temp"), "cyber-cafe-print-"));
  const htmlPath = path.join(printDirectory, "document.html");
  let printWindow: BrowserWindow | null = null;
  try {
    fs.writeFileSync(htmlPath, renderDocument(document), "utf8");
    const documentWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    printWindow = documentWindow;
    await documentWindow.loadFile(htmlPath);
    if (exportPdf) {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
        title: "Exporter le document en PDF",
        defaultPath: `${document.number ?? "document"}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (canceled || !filePath) return null;
      const pdf = await documentWindow.webContents.printToPDF({ pageSize: "A4", printBackground: true });
      fs.writeFileSync(filePath, pdf);
      return filePath;
    }
    return await new Promise<string | null>((resolve, reject) => {
      documentWindow.webContents.print({ printBackground: true }, (success, failureReason) => {
        if (success) resolve("printed");
        else reject(new Error(failureReason || "تعذرت طباعة المستند."));
      });
    });
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.close();
    fs.rmSync(printDirectory, { recursive: true, force: true });
  }
}

function wordImage(filePath: string): WordDocumentImage | undefined {
  if (!filePath) return undefined;
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) throw new Error(`تعذر قراءة صورة المستند: ${filePath}`);
  const dimensions = image.getSize();
  const scale = Math.min(1, 100 / dimensions.width, 60 / dimensions.height);
  return {
    data: image.toPNG(),
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
  };
}

async function exportDocumentWord(id: number): Promise<string | null> {
  const document = service.getDocument(id);
  if (!document) throw new Error("Document introuvable.");
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
    title: "حفظ المستند بصيغة Word",
    defaultPath: `${document.number ?? "document"}.docx`,
    filters: [{ name: "Microsoft Word", extensions: ["docx"] }],
  });
  if (canceled || !filePath) return null;
  const business = JSON.parse(document.business_snapshot) as BusinessSettings;
  const buffer = await createWordDocument(document, {
    logo: wordImage(business.logo_path),
    signature: wordImage(business.signature_path),
  });
  const destination = path.extname(filePath).toLowerCase() === ".docx" ? filePath : `${filePath}.docx`;
  fs.writeFileSync(destination, buffer);
  return destination;
}

function registerHandlers(): void {
  ipcMain.handle("business:get", () => service.getBusinessSettings());
  ipcMain.handle("business:save", (_event, value: BusinessSettings) => service.saveBusinessSettings(value));
  ipcMain.handle("tax:get", () => service.getTaxSettings());
  ipcMain.handle("tax:save", (_event, value) => service.saveTaxSettings(value));
  ipcMain.handle("sequences:get", () => service.getSequences());
  ipcMain.handle("sequences:save", (_event, values) => service.saveSequences(values));
  ipcMain.handle("image:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile"], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    return result.canceled ? null : service.saveImage(result.filePaths[0]);
  });
  ipcMain.handle("customers:list", (_event, search: string) => service.listCustomers(search));
  ipcMain.handle("customers:save", (_event, value) => service.saveCustomer(value));
  ipcMain.handle("customers:summary", (_event, id: number) => service.customerSummary(id));
  ipcMain.handle("documents:list", (_event, filters) => service.listDocuments(filters));
  ipcMain.handle("documents:get", (_event, id: number) => service.getDocument(id));
  ipcMain.handle("documents:related", (_event, id: number) => service.getRelatedDocuments(id));
  ipcMain.handle("documents:save", (_event, value) => service.saveDocument(value));
  ipcMain.handle("documents:issue", (_event, id: number) => service.issueDocument(id));
  ipcMain.handle("documents:convert", (_event, id: number) => service.convertProforma(id));
  ipcMain.handle("documents:cancel", (_event, id: number, reason: string) => service.cancelDocument(id, reason));
  ipcMain.handle("documents:duplicate", (_event, id: number) => service.duplicateDocument(id));
  ipcMain.handle("documents:quote-status", (_event, id: number, status) => service.setQuoteStatus(id, status));
  ipcMain.handle("payments:add", (_event, value) => service.addPayment(value));
  ipcMain.handle("documents:history", (_event, id: number) => service.getHistory(id));
  ipcMain.handle("documents:print", (_event, id: number, exportPdf: boolean) => printDocument(id, exportPdf));
  ipcMain.handle("documents:export-word", (_event, id: number) => exportDocumentWord(id));
  ipcMain.handle("data:open-folder", () => shell.openPath(context.userDataPath));
  ipcMain.handle("backup:create", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      title: "اختر مكان حفظ النسخة الاحتياطية", properties: ["openDirectory", "createDirectory"],
    });
    if (canceled || !filePaths[0]) return null;
    const target = path.join(filePaths[0], `cyber-cafe-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    return createBackupFolder(context, target);
  });
  ipcMain.handle("backup:restore", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      title: "اختر مجلد النسخة الاحتياطية", properties: ["openDirectory"],
    });
    if (canceled || !filePaths[0]) return;
    const backupPath = filePaths[0];
    try {
      context = restoreDatabaseBackup(context, backupPath);
      service = new BusinessService(context);
      mainWindow?.reload();
    } catch (error) {
      if (!context.db.open) context = openDatabase(context.userDataPath);
      service = new BusinessService(context);
      throw error;
    }
  });
  ipcMain.handle("files:list", (_event, search: string, categoryId: number | null) => service.listFiles(search, categoryId));
  ipcMain.handle("files:categories", () => service.listFileCategories());
  ipcMain.handle("files:add-category", (_event, name: string) => service.addFileCategory(name));
  ipcMain.handle("files:reorder-categories", (_event, ids: number[]) => service.reorderFileCategories(ids));
  ipcMain.handle("files:upload", async (_event, displayName: string, categoryId: number) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "اختر ملفاً",
      properties: ["openFile"],
      filters: [{ name: "مستندات Word وPDF وExcel", extensions: ["doc", "docx", "pdf", "xls", "xlsx"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return service.addManagedFile(result.filePaths[0], displayName, categoryId);
  });
  ipcMain.handle("files:rename", (_event, id: number, displayName: string) =>
    service.renameManagedFile(id, displayName));
  ipcMain.handle("files:set-category", (_event, id: number, categoryId: number) =>
    service.setManagedFileCategory(id, categoryId));
  ipcMain.handle("files:download", async (_event, id: number) => {
    const file = service.getManagedFile(id);
    if (!file) throw new Error("الملف غير موجود.");
    const safeName = file.display_name.replace(/[<>:"\\|?*]/g, "_").replace(/\//g, "_").replace(/[. ]+$/g, "").trim() || "word-document";
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "حفظ نسخة من الملف",
      defaultPath: `${safeName}${file.extension}`,
      filters: [{ name: "الملف الأصلي", extensions: [file.extension.slice(1)] }],
    });
    if (result.canceled || !result.filePath) return null;
    return service.copyManagedFile(id, result.filePath);
  });
  ipcMain.handle("files:open", async (_event, id: number) => {
    const file = service.getManagedFile(id);
    if (!file) throw new Error("الملف غير موجود.");
    const filePath = service.getManagedFilePath(id);
    if (file.extension === ".pdf") {
      await shell.openExternal(pathToFileURL(filePath).href);
      return;
    }
    const error = await shell.openPath(filePath);
    if (error) throw new Error(`تعذر فتح الملف في التطبيق الافتراضي: ${error}`);
  });
  ipcMain.handle("income:list", () => service.listDailyIncome());
  ipcMain.handle("income:save", (_event, value) => service.saveDailyIncome(value));
}

app.whenReady().then(() => {
  context = openDatabase(app.getPath("userData"));
  service = new BusinessService(context);
  registerHandlers();
  createWindow();
  const createDailyBackup = () => {
    try { createAutomaticBackup(context); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Automatic backup failed:", message);
      dialog.showErrorBox("تعذر إنشاء النسخة الاحتياطية التلقائية", message);
    }
  };
  createDailyBackup();
  const backupTimer = setInterval(createDailyBackup, 24 * 60 * 60 * 1000);
  app.on("before-quit", () => clearInterval(backupTimer));
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (context?.db.open) {
    context.db.pragma("wal_checkpoint(TRUNCATE)");
    context.db.close();
  }
});

