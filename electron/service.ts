import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  BusinessSettings,
  Customer,
  CustomerSummary,
  DocumentDraft,
  DocumentFilters,
  DocumentItem,
  DocumentRecord,
  DocumentType,
  FileCategoryRecord,
  ManagedFileExtension,
  ManagedFileRecord,
  TaxSettings,
} from "../shared/types";
import { documentTypes, type DatabaseContext } from "./database";

type StoredBusiness = BusinessSettings;
type TaxSnapshot = TaxSettings;
type Sequence = { type: DocumentType; prefix: string; start_number: number };

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const parse = <T>(value: string): T => JSON.parse(value) as T;

export class BusinessService {
  constructor(private readonly context: DatabaseContext) {}

  getBusinessSettings(): BusinessSettings {
    const row = this.context.db.prepare("SELECT * FROM business_settings WHERE id = 1").get() as
      | (BusinessSettings & { updated_at: string })
      | undefined;
    if (!row) throw new Error("تعذر تحميل معلومات المحل.");
    return row;
  }

  saveBusinessSettings(value: BusinessSettings): BusinessSettings {
    const fields = [
      "name", "address", "phone", "email", "website", "rc", "nif", "nis", "ai",
      "bank_info", "footer", "logo_path", "signature_path",
    ] as const;
    const values = fields.map((field) => value[field] ?? "");
    this.context.db.prepare(
      `UPDATE business_settings SET ${fields.map((field) => `${field} = ?`).join(", ")}, updated_at = ? WHERE id = 1`,
    ).run(...values, now());
    return this.getBusinessSettings();
  }

  getTaxSettings(): TaxSettings {
    const row = this.context.db.prepare("SELECT enabled, default_rate, price_mode FROM tax_settings WHERE id = 1").get() as
      | { enabled: number; default_rate: number | null; price_mode: "HT" | "TTC" }
      | undefined;
    if (!row) throw new Error("تعذر تحميل إعدادات الضريبة.");
    return { enabled: row.enabled === 1, default_rate: row.default_rate, price_mode: row.price_mode };
  }

  saveTaxSettings(value: TaxSettings): TaxSettings {
    if (value.default_rate !== null && (value.default_rate < 0 || value.default_rate > 100)) {
      throw new Error("يجب أن تكون نسبة TVA بين 0 و100.");
    }
    this.context.db.prepare(
      "UPDATE tax_settings SET enabled = ?, default_rate = ?, price_mode = ?, updated_at = ? WHERE id = 1",
    ).run(value.enabled ? 1 : 0, value.default_rate, value.price_mode, now());
    return this.getTaxSettings();
  }

  getSequences(): Sequence[] {
    return documentTypes.map((type) => {
      const row = this.context.db.prepare(
        "SELECT prefix, start_number FROM document_sequences WHERE type = ? ORDER BY year DESC LIMIT 1",
      ).get(type) as { prefix: string; start_number: number } | undefined;
      if (!row) throw new Error(`تعذر تحميل تسلسل ${type}.`);
      return { type, prefix: row.prefix, start_number: row.start_number };
    });
  }

  saveSequences(values: Sequence[]): void {
    const allowed = new Set<string>(documentTypes);
    const save = this.context.db.transaction(() => {
      for (const value of values) {
        if (!allowed.has(value.type) || !/^[A-Za-z0-9-]{1,10}$/.test(value.prefix) ||
            !Number.isInteger(value.start_number) || value.start_number < 1) {
          throw new Error("تحقق من بادئة ونقطة بداية الترقيم.");
        }
        const rows = this.context.db.prepare(
          "SELECT year, next_number FROM document_sequences WHERE type = ?",
        ).all(value.type) as Array<{ year: number; next_number: number }>;
        for (const row of rows) {
          if (row.next_number > value.start_number) {
            throw new Error(`لا يمكن خفض بداية الترقيم بعد إصدار مستندات من النوع ${value.type}.`);
          }
          this.context.db.prepare(
            "UPDATE document_sequences SET prefix = ?, start_number = ?, next_number = ? WHERE type = ? AND year = ?",
          ).run(value.prefix, value.start_number, value.start_number, value.type, row.year);
        }
      }
    });
    save();
  }

  listCustomers(search: string): Customer[] {
    const q = `%${search.trim()}%`;
    return this.context.db.prepare(
      "SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? OR nif LIKE ? ORDER BY name COLLATE NOCASE LIMIT 500",
    ).all(q, q, q, q) as Customer[];
  }

  saveCustomer(value: Partial<Customer>): Customer {
    const name = (value.name ?? "").trim();
    if (!name) throw new Error("اسم العميل مطلوب.");
    const timestamp = now();
    if (value.id) {
      this.context.db.prepare(
        "UPDATE customers SET name=?, address=?, phone=?, email=?, nif=?, notes=?, updated_at=? WHERE id=?",
      ).run(name, value.address ?? "", value.phone ?? "", value.email ?? "", value.nif ?? "", value.notes ?? "", timestamp, value.id);
      const updated = this.context.db.prepare("SELECT * FROM customers WHERE id = ?").get(value.id) as Customer | undefined;
      if (!updated) throw new Error("العميل غير موجود.");
      return updated;
    }
    const result = this.context.db.prepare(
      "INSERT INTO customers(name,address,phone,email,nif,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    ).run(name, value.address ?? "", value.phone ?? "", value.email ?? "", value.nif ?? "", value.notes ?? "", timestamp, timestamp);
    return this.context.db.prepare("SELECT * FROM customers WHERE id = ?").get(result.lastInsertRowid) as Customer;
  }

  customerSummary(id: number): CustomerSummary {
    const documents = this.context.db.prepare(
      "SELECT * FROM documents WHERE customer_id = ? ORDER BY issue_date DESC, id DESC",
    ).all(id) as DocumentRecord[];
    const unpaid = documents.filter((document) =>
      document.type === "INVOICE" && document.status !== "CANCELLED" && document.balance > 0.005);
    const payments = this.context.db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE invoice_id IN (SELECT id FROM documents WHERE customer_id=?)",
    ).get(id) as { total: number };
    return {
      documents,
      unpaid,
      paid_total: money(payments.total),
      balance_total: money(unpaid.reduce((sum, document) => sum + document.balance, 0)),
    };
  }

  listDocuments(filters: DocumentFilters): DocumentRecord[] {
    const conditions = ["(d.number LIKE @search OR c.name LIKE @search OR d.customer_snapshot LIKE @search)"];
    const params: Record<string, unknown> = { search: `%${filters.search.trim()}%` };
    if (filters.type) { conditions.push("d.type = @type"); params.type = filters.type; }
    if (filters.status) { conditions.push("d.status = @status"); params.status = filters.status; }
    if (filters.from) { conditions.push("d.issue_date >= @from"); params.from = filters.from; }
    if (filters.to) { conditions.push("d.issue_date <= @to"); params.to = filters.to; }
    if (filters.min_amount !== undefined && filters.min_amount !== "") {
      const minimum = Number(filters.min_amount);
      if (!Number.isFinite(minimum) || minimum < 0) throw new Error("الحد الأدنى للمبلغ غير صالح.");
      conditions.push("d.total_ttc >= @min_amount");
      params.min_amount = minimum;
    }
    if (filters.max_amount !== undefined && filters.max_amount !== "") {
      const maximum = Number(filters.max_amount);
      if (!Number.isFinite(maximum) || maximum < 0) throw new Error("الحد الأعلى للمبلغ غير صالح.");
      conditions.push("d.total_ttc <= @max_amount");
      params.max_amount = maximum;
    }
    if (params.min_amount !== undefined && params.max_amount !== undefined && Number(params.min_amount) > Number(params.max_amount)) {
      throw new Error("الحد الأدنى للمبلغ أكبر من الحد الأعلى.");
    }
    return this.context.db.prepare(
      `SELECT d.* FROM documents d LEFT JOIN customers c ON c.id=d.customer_id WHERE ${conditions.join(" AND ")} ORDER BY d.issue_date DESC, d.id DESC LIMIT 1000`,
    ).all(params) as DocumentRecord[];
  }

  getDocument(id: number): DocumentRecord | null {
    const record = this.context.db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRecord | undefined;
    if (!record) return null;
    record.items = this.context.db.prepare("SELECT * FROM document_items WHERE document_id = ? ORDER BY id").all(id) as DocumentItem[];
    return record;
  }

  getRelatedDocuments(id: number): Array<DocumentRecord & { relation_type: string; direction: "INCOMING" | "OUTGOING" }> {
    return this.context.db.prepare(
      `SELECT d.*, r.relation_type,
      CASE WHEN r.source_document_id = @id THEN 'OUTGOING' ELSE 'INCOMING' END AS direction
      FROM document_relations r
      JOIN documents d ON d.id = CASE WHEN r.source_document_id = @id THEN r.target_document_id ELSE r.source_document_id END
      WHERE r.source_document_id = @id OR r.target_document_id = @id
      ORDER BY r.created_at DESC`,
    ).all({ id }) as Array<DocumentRecord & { relation_type: string; direction: "INCOMING" | "OUTGOING" }>;
  }

  saveDocument(draft: DocumentDraft): DocumentRecord {
    if (!documentTypes.includes(draft.type)) throw new Error("نوع المستند غير صالح.");
    if (draft.type === "RECEIPT") throw new Error("يتم إنشاء إيصالات الدفع من خلال تسجيل دفعة على فاتورة.");
    if (draft.type === "CREDIT_NOTE") {
      if (!draft.related_document_id || !draft.notes.trim()) {
        throw new Error("إشعار الدائن يتطلب فاتورة مرتبطة وسبباً واضحاً.");
      }
      const related = this.getDocument(draft.related_document_id);
      if (!related || related.type !== "INVOICE" || related.status === "DRAFT" || related.status === "CANCELLED") {
        throw new Error("اختر فاتورة صادرة وغير ملغاة لإرفاق إشعار الدائن بها.");
      }
    }
    if (!draft.items.length || draft.items.some((item) =>
      !item.description.trim() || !Number.isFinite(item.quantity) || item.quantity <= 0 ||
      !Number.isFinite(item.unit_price) || item.unit_price < 0 ||
      !Number.isFinite(item.discount) || item.discount < 0 || item.discount > 100)) {
      throw new Error("أضف بنداً صالحاً واحداً على الأقل وتحقق من الكمية والسعر والتخفيض.");
    }
    const customer = draft.customer_id
      ? this.context.db.prepare("SELECT * FROM customers WHERE id=?").get(draft.customer_id) as Customer | undefined
      : null;
    if (draft.customer_id && !customer) throw new Error("العميل المحدد غير موجود.");
    const customerSnapshot = JSON.stringify(customer ? this.snapshotCustomer(customer) : this.snapshotCustomer(draft.customer));
    const businessSnapshot = JSON.stringify(this.getBusinessSettings());
    const taxSnapshot = this.getTaxSettings();
    const normalized = this.calculateLines(draft.items, taxSnapshot);
    const totals = this.sumLines(normalized);
    const timestamp = now();
    const operation = this.context.db.transaction(() => {
      const status = draft.issue_now ? "ISSUED" : "DRAFT";
      if (draft.issue_now) this.validateBusiness();
      const result = this.context.db.prepare(
        `INSERT INTO documents(number,type,status,customer_id,customer_snapshot,business_snapshot,tax_snapshot,
        subtotal_ht,total_tax,total_ttc,paid_amount,balance,issue_date,due_date,validity_days,payment_terms,notes,created_at,updated_at)
        VALUES(NULL,?,?,?,?,?,?,?,?,?,0,?,?,?, ?,?,?,?,?)`,
      ).run(
        draft.type, status, draft.customer_id, customerSnapshot, businessSnapshot, JSON.stringify(taxSnapshot),
        totals.subtotal_ht, totals.total_tax, totals.total_ttc, totals.total_ttc,
        draft.issue_date || today(), draft.due_date || "", draft.validity_days, draft.payment_terms ?? "",
        draft.notes ?? "", timestamp, timestamp,
      );
      const documentId = Number(result.lastInsertRowid);
      const insertItem = this.context.db.prepare(
        "INSERT INTO document_items(document_id,description,quantity,unit_price,discount,tax_rate,line_ht,tax_amount,line_ttc) VALUES(?,?,?,?,?,?,?,?,?)",
      );
      for (const item of normalized) {
        insertItem.run(documentId, item.description, item.quantity, item.unit_price, item.discount,
          item.tax_rate, item.line_ht, item.tax_amount, item.line_ttc);
      }
      if (draft.type === "CREDIT_NOTE" && draft.related_document_id) {
        this.context.db.prepare(
          "INSERT INTO document_relations(source_document_id,target_document_id,relation_type,created_at) VALUES(?,?,'CREDIT_FOR',?)",
        ).run(draft.related_document_id, documentId, timestamp);
      }
      if (draft.issue_now) this.assignNumber(documentId, draft.type, draft.issue_date || today());
      if (draft.issue_now) this.addStatusHistory(documentId, "DRAFT", "ISSUED", "");
      return documentId;
    });
    return this.getDocument(operation())!;
  }

  issueDocument(id: number): DocumentRecord {
    const operation = this.context.db.transaction(() => {
      const document = this.getDocument(id);
      if (!document) throw new Error("المستند غير موجود.");
      if (document.status !== "DRAFT") throw new Error("يمكن إصدار المسودات فقط.");
      if (document.type === "RECEIPT") throw new Error("إيصال الدفع يصدر حصراً عند تسجيل دفعة على فاتورة.");
      this.validateBusiness();
      if (document.type === "INVOICE" && this.getTaxSettings().enabled) {
        const tax: TaxSnapshot = parse(document.tax_snapshot);
        if (document.items?.some((item) => item.tax_rate === null) && tax.default_rate === null) {
          throw new Error("TVA مفعّلة لكن لم تُحدد نسبة للبنود ولا نسبة افتراضية.");
        }
      }
      this.context.db.prepare("UPDATE documents SET status='ISSUED', updated_at=? WHERE id=?").run(now(), id);
      this.assignNumber(id, document.type, document.issue_date);
      this.addStatusHistory(id, "DRAFT", "ISSUED", "");
    });
    operation();
    return this.getDocument(id)!;
  }

  convertProforma(id: number): DocumentRecord {
    const operation = this.context.db.transaction(() => {
      const source = this.getDocument(id);
      if (!source || source.type !== "PROFORMA") {
        throw new Error("لا يمكن تحويل هذا المستند؛ يجب أن تكون الفاتورة الأولية صادرة.");
      }
      const converted = this.context.db.prepare(
        "SELECT id FROM document_relations WHERE source_document_id=? AND relation_type='CONVERTED_TO'",
      ).get(id);
      if (converted) throw new Error("تم تحويل هذه الفاتورة الأولية مسبقاً.");
      if (source.status !== "ISSUED") {
        throw new Error("لا يمكن تحويل هذا المستند؛ يجب أن تكون الفاتورة الأولية صادرة.");
      }
      const result = this.context.db.prepare(
        `INSERT INTO documents(type,status,customer_id,customer_snapshot,business_snapshot,tax_snapshot,subtotal_ht,
        total_tax,total_ttc,paid_amount,balance,issue_date,due_date,payment_terms,notes,created_at,updated_at)
        VALUES('INVOICE','ISSUED',?,?,?,?,?,?,?,0,?,?,?,?, ?,?,?)`,
      ).run(source.customer_id, source.customer_snapshot, source.business_snapshot, source.tax_snapshot,
        source.subtotal_ht, source.total_tax, source.total_ttc, source.total_ttc, today(), source.due_date,
        source.payment_terms, `Convertie depuis ${source.number ?? "la proforma"}`, now(), now());
      const invoiceId = Number(result.lastInsertRowid);
      this.context.db.prepare(
        `INSERT INTO document_items(document_id,description,quantity,unit_price,discount,tax_rate,line_ht,tax_amount,line_ttc)
        SELECT ?,description,quantity,unit_price,discount,tax_rate,line_ht,tax_amount,line_ttc FROM document_items WHERE document_id=?`,
      ).run(invoiceId, id);
      this.assignNumber(invoiceId, "INVOICE", today());
      this.context.db.prepare(
        "INSERT INTO document_relations(source_document_id,target_document_id,relation_type,created_at) VALUES(?,?,'CONVERTED_TO',?)",
      ).run(id, invoiceId, now());
      this.context.db.prepare("UPDATE documents SET status='CONVERTED', updated_at=? WHERE id=?").run(now(), id);
      this.addStatusHistory(id, "ISSUED", "CONVERTED", `Convertie vers ${invoiceId}`);
      this.addStatusHistory(invoiceId, "DRAFT", "ISSUED", `Conversion de ${source.number ?? id}`);
      return invoiceId;
    });
    return this.getDocument(operation())!;
  }

  cancelDocument(id: number, reason: string): void {
    const cleanReason = reason.trim();
    if (cleanReason.length < 3) throw new Error("أدخل سبباً واضحاً للإلغاء.");
    const operation = this.context.db.transaction(() => {
      const document = this.getDocument(id);
      if (!document) throw new Error("المستند غير موجود.");
      if (document.status === "DRAFT" || document.status === "CANCELLED") {
        throw new Error("لا يمكن إلغاء هذه الحالة.");
      }
      this.context.db.prepare(
        "UPDATE documents SET status='CANCELLED', cancel_reason=?, updated_at=? WHERE id=?",
      ).run(cleanReason, now(), id);
      this.addStatusHistory(id, document.status, "CANCELLED", cleanReason);
    });
    operation();
  }

  duplicateDocument(id: number): DocumentRecord {
    const source = this.getDocument(id);
    if (!source || !source.items) throw new Error("المستند غير موجود.");
    if (source.type === "RECEIPT") throw new Error("لا يمكن نسخ إيصال دفع كمسودة مستقلة.");
    const operation = this.context.db.transaction(() => {
      const result = this.context.db.prepare(
        `INSERT INTO documents(type,status,customer_id,customer_snapshot,business_snapshot,tax_snapshot,
        subtotal_ht,total_tax,total_ttc,paid_amount,balance,issue_date,due_date,validity_days,payment_terms,notes,created_at,updated_at)
        VALUES(?,'DRAFT',?,?,?,?,?,?,?,0,?,?,?, ?,?,?,?,?)`,
      ).run(source.type, source.customer_id, source.customer_snapshot, source.business_snapshot, source.tax_snapshot,
        source.subtotal_ht, source.total_tax, source.total_ttc, source.total_ttc, today(), source.due_date,
        source.validity_days, source.payment_terms, source.notes, now(), now());
      const idNew = Number(result.lastInsertRowid);
      this.context.db.prepare(
        `INSERT INTO document_items(document_id,description,quantity,unit_price,discount,tax_rate,line_ht,tax_amount,line_ttc)
        SELECT ?,description,quantity,unit_price,discount,tax_rate,line_ht,tax_amount,line_ttc FROM document_items WHERE document_id=?`,
      ).run(idNew, id);
      return idNew;
    });
    return this.getDocument(operation())!;
  }

  setQuoteStatus(id: number, status: "ACCEPTED" | "REJECTED"): void {
    const operation = this.context.db.transaction(() => {
      const document = this.getDocument(id);
      if (!document || document.type !== "QUOTE" || document.status !== "ISSUED") {
        throw new Error("يمكن تعديل حالة عرض السعر الصادر فقط.");
      }
      this.context.db.prepare("UPDATE documents SET status=?, updated_at=? WHERE id=?").run(status, now(), id);
      this.addStatusHistory(id, document.status, status, "");
    });
    operation();
  }

  addPayment(value: { invoice_id: number; amount: number; method: string; date: string }): DocumentRecord {
    if (!Number.isFinite(value.amount) || value.amount <= 0) throw new Error("أدخل مبلغاً صحيحاً.");
    const operation = this.context.db.transaction(() => {
      const invoice = this.getDocument(value.invoice_id);
      if (!invoice || invoice.type !== "INVOICE" || invoice.status !== "ISSUED") {
        throw new Error("تُسجّل الدفعات على الفواتير الصادرة فقط.");
      }
      if (value.amount > invoice.balance + 0.005) throw new Error("المبلغ يتجاوز الرصيد المتبقي.");
      const receiptId = Number(this.context.db.prepare(
        `INSERT INTO documents(type,status,customer_id,customer_snapshot,business_snapshot,tax_snapshot,
        subtotal_ht,total_tax,total_ttc,paid_amount,balance,issue_date,payment_terms,notes,created_at,updated_at)
        VALUES('RECEIPT','ISSUED',?,?,?,?,0,0,?, ?,0,?,'',?,?,?)`,
      ).run(invoice.customer_id, invoice.customer_snapshot, invoice.business_snapshot, invoice.tax_snapshot,
        value.amount, value.amount, value.date || today(), `Mode: ${value.method}; facture: ${invoice.number ?? ""}`, now(), now()).lastInsertRowid);
      this.assignNumber(receiptId, "RECEIPT", value.date || today());
      this.context.db.prepare(
        "INSERT INTO payments(invoice_id,receipt_document_id,amount,method,payment_date,created_at) VALUES(?,?,?,?,?,?)",
      ).run(invoice.id, receiptId, money(value.amount), value.method, value.date || today(), now());
      const paid = money(invoice.paid_amount + value.amount);
      const balance = money(Math.max(0, invoice.total_ttc - paid));
      this.context.db.prepare("UPDATE documents SET paid_amount=?, balance=?, updated_at=? WHERE id=?").run(paid, balance, now(), invoice.id);
      this.context.db.prepare(
        "INSERT INTO document_relations(source_document_id,target_document_id,relation_type,created_at) VALUES(?,?,'PAYMENT_RECEIPT',?)",
      ).run(invoice.id, receiptId, now());
      this.addStatusHistory(invoice.id, invoice.status, invoice.status, `Paiement ${value.amount} ${value.method}`);
      return invoice.id;
    });
    return this.getDocument(operation())!;
  }

  getHistory(id: number): Array<{ action: string; reason: string; created_at: string }> {
    const statuses = this.context.db.prepare(
      "SELECT old_status || ' → ' || new_status AS action, reason, created_at FROM document_status_history WHERE document_id=? ORDER BY created_at DESC",
    ).all(id) as Array<{ action: string; reason: string; created_at: string }>;
    const number = this.context.db.prepare(
      "SELECT 'Numéro attribué: ' || document_number AS action, '' AS reason, issued_at AS created_at FROM document_numbering_history WHERE document_id=?",
    ).all(id) as Array<{ action: string; reason: string; created_at: string }>;
    return [...statuses, ...number].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  saveImage(source: string): string {
    const ext = path.extname(source).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw new Error("صيغة الصورة غير مدعومة.");
    const target = path.join(this.context.attachmentsPath, `${randomUUID()}${ext}`);
    fs.copyFileSync(source, target);
    return target;
  }

  listFiles(search: string, categoryId: number | null): ManagedFileRecord[] {
    const query = `%${search.trim()}%`;
    const categoryClause = categoryId === null ? "" : "AND m.category_id=?";
    const values: Array<string | number> = [query, query];
    if (categoryId !== null) {
      if (!Number.isInteger(categoryId) || categoryId < 1) throw new Error("التصنيف المحدد غير صالح.");
      values.push(categoryId);
    }
    return this.context.db.prepare(
      `SELECT m.id,m.display_name,m.original_name,m.extension,m.category_id,c.name AS category_name,m.size_bytes,m.created_at
      FROM managed_files m JOIN file_categories c ON c.id=m.category_id
      WHERE (m.display_name LIKE ? OR m.original_name LIKE ?) ${categoryClause}
      ORDER BY c.sort_order, m.created_at DESC, m.id DESC LIMIT 2000`,
    ).all(...values) as ManagedFileRecord[];
  }

  listFileCategories(): FileCategoryRecord[] {
    return this.context.db.prepare(
      `SELECT c.id,c.name,c.sort_order,COUNT(m.id) AS file_count
      FROM file_categories c LEFT JOIN managed_files m ON m.category_id=c.id
      GROUP BY c.id ORDER BY c.sort_order,c.name COLLATE NOCASE`,
    ).all() as FileCategoryRecord[];
  }

  addFileCategory(requestedName: string): FileCategoryRecord {
    const name = this.cleanCategoryName(requestedName);
    if (this.context.db.prepare("SELECT id FROM file_categories WHERE name=? COLLATE NOCASE").get(name)) {
      throw new Error("يوجد تصنيف بهذا الاسم.");
    }
    const nextOrder = this.context.db.prepare(
      "SELECT COALESCE(MAX(sort_order),-1)+1 AS next_order FROM file_categories",
    ).get() as { next_order: number };
    const result = this.context.db.prepare(
      "INSERT INTO file_categories(name,sort_order,created_at) VALUES(?,?,?)",
    ).run(name, nextOrder.next_order, now());
    return this.context.db.prepare(
      `SELECT c.id,c.name,c.sort_order,COUNT(m.id) AS file_count
      FROM file_categories c LEFT JOIN managed_files m ON m.category_id=c.id
      WHERE c.id=? GROUP BY c.id`,
    ).get(result.lastInsertRowid) as FileCategoryRecord;
  }

  reorderFileCategories(ids: number[]): void {
    const categories = this.listFileCategories();
    if (ids.length !== categories.length || new Set(ids).size !== ids.length ||
        ids.some((id) => !categories.some((category) => category.id === id))) {
      throw new Error("تعذر ترتيب التصنيفات؛ حدّث القائمة وحاول مجدداً.");
    }
    const update = this.context.db.prepare("UPDATE file_categories SET sort_order=? WHERE id=?");
    const operation = this.context.db.transaction(() => {
      ids.forEach((id, index) => update.run(index, id));
    });
    operation();
  }

  addManagedFile(sourcePath: string, requestedName: string, categoryId: number): ManagedFileRecord {
    const extension = path.extname(sourcePath).toLowerCase();
    const supportedExtensions: ManagedFileExtension[] = [".doc", ".docx", ".pdf", ".xls", ".xlsx"];
    if (!supportedExtensions.some((supported) => supported === extension)) throw new Error("الصيغ المدعومة هي Word وPDF وExcel.");
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile()) throw new Error("الملف المحدد ليس ملفاً صالحاً.");
    if (!this.context.db.prepare("SELECT id FROM file_categories WHERE id=?").get(categoryId)) {
      throw new Error("التصنيف المحدد غير موجود.");
    }
    const originalName = path.basename(sourcePath);
    const displayName = this.cleanDisplayName(requestedName, extension) ||
      path.basename(originalName, extension);
    if (!displayName) throw new Error("اسم الملف مطلوب.");
    const storedName = `${randomUUID()}${extension}`;
    const destination = path.join(this.context.wordDocumentsPath, storedName);
    fs.copyFileSync(sourcePath, destination);
    try {
      const result = this.context.db.prepare(
        `INSERT INTO managed_files(display_name,original_name,stored_name,extension,category_id,size_bytes,created_at)
        VALUES(?,?,?,?,?,?,?)`,
      ).run(displayName, originalName, storedName, extension, categoryId, stat.size, now());
      return this.getManagedFile(Number(result.lastInsertRowid))!;
    } catch (error) {
      fs.rmSync(destination, { force: true });
      throw error;
    }
  }

  renameManagedFile(id: number, requestedName: string): ManagedFileRecord {
    const file = this.getManagedFile(id);
    if (!file) throw new Error("الملف غير موجود.");
    const displayName = this.cleanDisplayName(requestedName, file.extension);
    if (!displayName) throw new Error("اسم الملف مطلوب.");
    this.context.db.prepare("UPDATE managed_files SET display_name=? WHERE id=?").run(displayName, id);
    return this.getManagedFile(id)!;
  }

  setManagedFileCategory(id: number, categoryId: number): ManagedFileRecord {
    if (!this.getManagedFile(id)) throw new Error("الملف غير موجود.");
    if (!this.context.db.prepare("SELECT id FROM file_categories WHERE id=?").get(categoryId)) {
      throw new Error("التصنيف المحدد غير موجود.");
    }
    const result = this.context.db.prepare(
      "UPDATE managed_files SET category_id=? WHERE id=?",
    ).run(categoryId, id);
    if (result.changes === 0) throw new Error("لم يتغير تصنيف الملف.");
    return this.getManagedFile(id)!;
  }

  copyManagedFile(id: number, destination: string): string {
    const file = this.context.db.prepare(
      "SELECT stored_name FROM managed_files WHERE id=?",
    ).get(id) as { stored_name: string } | undefined;
    if (!file) throw new Error("الملف غير موجود.");
    const source = path.join(this.context.wordDocumentsPath, file.stored_name);
    if (!fs.existsSync(source)) throw new Error("الملف محفوظ في السجل لكن محتواه غير موجود على القرص.");
    fs.copyFileSync(source, destination);
    return destination;
  }

  getManagedFilePath(id: number): string {
    const file = this.context.db.prepare(
      "SELECT stored_name FROM managed_files WHERE id=?",
    ).get(id) as { stored_name: string } | undefined;
    if (!file) throw new Error("الملف غير موجود.");
    const source = path.join(this.context.wordDocumentsPath, file.stored_name);
    if (!fs.existsSync(source)) throw new Error("الملف محفوظ في السجل لكن محتواه غير موجود على القرص.");
    return source;
  }

  getManagedFile(id: number): ManagedFileRecord | null {
    return (this.context.db.prepare(
      `SELECT m.id,m.display_name,m.original_name,m.extension,m.category_id,c.name AS category_name,m.size_bytes,m.created_at
      FROM managed_files m JOIN file_categories c ON c.id=m.category_id WHERE m.id=?`,
    ).get(id) as ManagedFileRecord | undefined) ?? null;
  }

  private cleanDisplayName(value: string, extension: string): string {
    const withoutExtension = value.trim().replace(new RegExp(`${extension.replace(".", "\\.")}$`, "i"), "").trim();
    if (withoutExtension.length > 150) throw new Error("اسم الملف طويل جداً (الحد الأقصى 150 حرفاً).");
    if (/[\u0000-\u001f]/.test(withoutExtension)) throw new Error("اسم الملف يحتوي على محارف غير صالحة.");
    return withoutExtension;
  }

  private cleanCategoryName(value: string): string {
    const name = value.trim();
    if (!name || name.length > 60 || /[\u0000-\u001f]/.test(name)) {
      throw new Error("اسم التصنيف مطلوب ويجب ألا يتجاوز 60 حرفاً.");
    }
    return name;
  }

  private validateBusiness(): void {
    const business = this.getBusinessSettings();
    const missing = [
      ["name", "اسم المحل"], ["address", "العنوان"], ["phone", "رقم الهاتف"],
    ].filter(([key]) => !String(business[key as keyof BusinessSettings] ?? "").trim()).map(([, label]) => label);
    if (missing.length) throw new Error(`أكمل معلومات المحل قبل إصدار المستند: ${missing.join("، ")}.`);
  }

  private snapshotCustomer(customer: Omit<Customer, "id" | "created_at"> | Customer): Omit<Customer, "id" | "created_at"> {
    return {
      name: customer.name ?? "", address: customer.address ?? "", phone: customer.phone ?? "",
      email: customer.email ?? "", nif: customer.nif ?? "", notes: customer.notes ?? "",
    };
  }

  private calculateLines(
    items: DocumentDraft["items"],
    tax: TaxSettings,
  ): DocumentItem[] {
    return items.map((item) => {
      const rate = tax.enabled ? (item.tax_rate ?? tax.default_rate) : null;
      if (tax.enabled && rate === null) {
        return {
          description: item.description.trim(), quantity: item.quantity, unit_price: item.unit_price,
          discount: item.discount, tax_rate: null, line_ht: 0, tax_amount: 0, line_ttc: 0,
        };
      }
      const discountedPrice = item.unit_price * item.quantity * (1 - item.discount / 100);
      if (!tax.enabled || rate === null || rate === 0) {
        const line = money(discountedPrice);
        return {
          description: item.description.trim(), quantity: item.quantity, unit_price: item.unit_price,
          discount: item.discount, tax_rate: tax.enabled ? rate : null, line_ht: line, tax_amount: 0, line_ttc: line,
        };
      }
      const ratio = rate / 100;
      const lineHt = tax.price_mode === "TTC" ? money(discountedPrice / (1 + ratio)) : money(discountedPrice);
      const total = tax.price_mode === "TTC" ? money(discountedPrice) : money(lineHt * (1 + ratio));
      return {
        description: item.description.trim(), quantity: item.quantity, unit_price: item.unit_price,
        discount: item.discount, tax_rate: rate, line_ht: lineHt, tax_amount: money(total - lineHt), line_ttc: total,
      };
    });
  }

  private sumLines(items: DocumentItem[]) {
    return {
      subtotal_ht: money(items.reduce((sum, item) => sum + item.line_ht, 0)),
      total_tax: money(items.reduce((sum, item) => sum + item.tax_amount, 0)),
      total_ttc: money(items.reduce((sum, item) => sum + item.line_ttc, 0)),
    };
  }

  private assignNumber(id: number, type: DocumentType, date: string): void {
    const year = Number(date.slice(0, 4));
    if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error("تاريخ المستند غير صالح.");
    this.context.db.prepare(
      "INSERT OR IGNORE INTO document_sequences(type,year,prefix,next_number,start_number) SELECT type,?,prefix,start_number,start_number FROM document_sequences WHERE type=? ORDER BY year DESC LIMIT 1",
    ).run(year, type);
    const sequence = this.context.db.prepare(
      "SELECT prefix,next_number FROM document_sequences WHERE type=? AND year=?",
    ).get(type, year) as { prefix: string; next_number: number } | undefined;
    if (!sequence) throw new Error("إعداد تسلسل أرقام المستند غير موجود.");
    const number = `${sequence.prefix}-${year}-${String(sequence.next_number).padStart(4, "0")}`;
    this.context.db.prepare("UPDATE document_sequences SET next_number=? WHERE type=? AND year=?")
      .run(sequence.next_number + 1, type, year);
    this.context.db.prepare("UPDATE documents SET number=? WHERE id=?").run(number, id);
    this.context.db.prepare(
      "INSERT INTO document_numbering_history(document_id,type,year,prefix,sequence_number,document_number,issued_at) VALUES(?,?,?,?,?,?,?)",
    ).run(id, type, year, sequence.prefix, sequence.next_number, number, now());
  }

  private addStatusHistory(id: number, oldStatus: string, newStatus: string, reason: string): void {
    this.context.db.prepare(
      "INSERT INTO document_status_history(document_id,old_status,new_status,reason,created_at) VALUES(?,?,?,?,?)",
    ).run(id, oldStatus, newStatus, reason, now());
  }
}
