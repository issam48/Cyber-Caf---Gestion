import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const documentTypes = [
  "INVOICE",
  "PROFORMA",
  "QUOTE",
  "PURCHASE_ORDER",
  "RECEIPT",
  "CREDIT_NOTE",
] as const;

const prefixes: Record<(typeof documentTypes)[number], string> = {
  INVOICE: "FAC",
  PROFORMA: "PRO",
  QUOTE: "DEV",
  PURCHASE_ORDER: "BC",
  RECEIPT: "REC",
  CREDIT_NOTE: "AV",
};

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS business_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', rc TEXT NOT NULL DEFAULT '',
  nif TEXT NOT NULL DEFAULT '', nis TEXT NOT NULL DEFAULT '', ai TEXT NOT NULL DEFAULT '',
  bank_info TEXT NOT NULL DEFAULT '', footer TEXT NOT NULL DEFAULT '',
  logo_path TEXT NOT NULL DEFAULT '', signature_path TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO business_settings (id, updated_at) VALUES (1, datetime('now'));
CREATE TABLE IF NOT EXISTS tax_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  default_rate REAL, price_mode TEXT NOT NULL DEFAULT 'HT' CHECK (price_mode IN ('HT', 'TTC')),
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO tax_settings (id, updated_at) VALUES (1, datetime('now'));
CREATE TABLE IF NOT EXISTS document_sequences (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, year INTEGER NOT NULL, prefix TEXT NOT NULL,
  next_number INTEGER NOT NULL CHECK (next_number >= 1), start_number INTEGER NOT NULL CHECK (start_number >= 1),
  UNIQUE(type, year)
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', nif TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, number TEXT UNIQUE, type TEXT NOT NULL, status TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_snapshot TEXT NOT NULL, business_snapshot TEXT NOT NULL, tax_snapshot TEXT NOT NULL,
  subtotal_ht REAL NOT NULL DEFAULT 0, total_tax REAL NOT NULL DEFAULT 0, total_ttc REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0, balance REAL NOT NULL DEFAULT 0,
  issue_date TEXT NOT NULL, due_date TEXT NOT NULL DEFAULT '', validity_days INTEGER,
  payment_terms TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  cancel_reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_type_date ON documents(type, issue_date);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_customer ON documents(customer_id);
CREATE TABLE IF NOT EXISTS document_items (
  id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id),
  description TEXT NOT NULL, quantity REAL NOT NULL, unit_price REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0, tax_rate REAL, line_ht REAL NOT NULL,
  tax_amount REAL NOT NULL, line_ttc REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_document_items_document ON document_items(document_id);
CREATE TABLE IF NOT EXISTS document_relations (
  id INTEGER PRIMARY KEY, source_document_id INTEGER NOT NULL REFERENCES documents(id),
  target_document_id INTEGER NOT NULL REFERENCES documents(id),
  relation_type TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(source_document_id, target_document_id, relation_type)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES documents(id),
  receipt_document_id INTEGER REFERENCES documents(id), amount REAL NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL, payment_date TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE TABLE IF NOT EXISTS document_status_history (
  id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id),
  old_status TEXT NOT NULL, new_status TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS document_numbering_history (
  id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id),
  type TEXT NOT NULL, year INTEGER NOT NULL, prefix TEXT NOT NULL, sequence_number INTEGER NOT NULL,
  document_number TEXT NOT NULL UNIQUE, issued_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS word_documents (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  extension TEXT NOT NULL CHECK (extension IN ('.doc', '.docx')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_word_documents_name ON word_documents(display_name);
CREATE TABLE IF NOT EXISTS file_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO file_categories(id, name, sort_order, created_at)
VALUES (1, 'غير مصنف', 0, datetime('now'));
CREATE TABLE IF NOT EXISTS managed_files (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  extension TEXT NOT NULL CHECK (extension IN ('.doc', '.docx', '.pdf', '.xls', '.xlsx')),
  category_id INTEGER NOT NULL DEFAULT 1 REFERENCES file_categories(id),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_managed_files_name ON managed_files(display_name);
CREATE INDEX IF NOT EXISTS idx_managed_files_category ON managed_files(category_id);
INSERT OR IGNORE INTO managed_files(id, display_name, original_name, stored_name, extension, category_id, size_bytes, created_at)
SELECT id, display_name, original_name, stored_name, extension, 1, size_bytes, created_at
FROM word_documents;
`;

export interface DatabaseContext {
  db: Database.Database;
  databasePath: string;
  userDataPath: string;
  attachmentsPath: string;
  wordDocumentsPath: string;
}

export function openDatabase(userDataPath: string): DatabaseContext {
  fs.mkdirSync(userDataPath, { recursive: true });
  const attachmentsPath = path.join(userDataPath, "attachments");
  fs.mkdirSync(attachmentsPath, { recursive: true });
  const wordDocumentsPath = path.join(attachmentsPath, "word_documents");
  fs.mkdirSync(wordDocumentsPath, { recursive: true });
  const databasePath = path.join(userDataPath, "business.sqlite");
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version > 3) {
    db.close();
    throw new Error(`قاعدة البيانات بإصدار أحدث غير مدعوم: ${version}.`);
  }
  const migrate = db.transaction(() => {
    db.exec(schema);
    db.pragma("user_version = 3");
  });
  migrate();
  const insertSequence = db.prepare(
    "INSERT OR IGNORE INTO document_sequences(type, year, prefix, next_number, start_number) VALUES (?, ?, ?, 1, 1)",
  );
  const year = new Date().getFullYear();
  for (const type of documentTypes) {
    insertSequence.run(type, year, prefixes[type]);
  }
  return { db, databasePath, userDataPath, attachmentsPath, wordDocumentsPath };
}
