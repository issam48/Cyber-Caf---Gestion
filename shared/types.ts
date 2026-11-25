export type DocumentType =
  | "INVOICE"
  | "PROFORMA"
  | "QUOTE"
  | "PURCHASE_ORDER"
  | "RECEIPT"
  | "CREDIT_NOTE";

export type DocumentStatus =
  | "DRAFT"
  | "ISSUED"
  | "CONVERTED"
  | "CANCELLED"
  | "ACCEPTED"
  | "REJECTED"
  | "PENDING";

export interface BusinessSettings {
  id?: number;
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  rc: string;
  nif: string;
  nis: string;
  ai: string;
  bank_info: string;
  footer: string;
  logo_path: string;
  signature_path: string;
}

export interface TaxSettings {
  enabled: boolean;
  default_rate: number | null;
  price_mode: "HT" | "TTC";
}

export interface Customer {
  id: number;
  name: string;
  address: string;
  phone: string;
  email: string;
  nif: string;
  notes: string;
  created_at: string;
}

export interface DocumentItem {
  id?: number;
  description: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tax_rate: number | null;
  line_ht: number;
  tax_amount: number;
  line_ttc: number;
}

export interface DocumentRecord {
  id: number;
  number: string | null;
  type: DocumentType;
  status: DocumentStatus;
  customer_id: number | null;
  customer_snapshot: string;
  business_snapshot: string;
  tax_snapshot: string;
  subtotal_ht: number;
  total_tax: number;
  total_ttc: number;
  paid_amount: number;
  balance: number;
  issue_date: string;
  due_date: string;
  validity_days: number | null;
  payment_terms: string;
  notes: string;
  cancel_reason: string;
  created_at: string;
  items?: DocumentItem[];
}

export interface DocumentDraft {
  type: DocumentType;
  customer_id: number | null;
  related_document_id: number | null;
  customer: Omit<Customer, "id" | "created_at">;
  issue_date: string;
  due_date: string;
  validity_days: number | null;
  payment_terms: string;
  notes: string;
  items: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    discount: number;
    tax_rate: number | null;
  }>;
  issue_now: boolean;
}

export interface DocumentFilters {
  search: string;
  type: DocumentType | "";
  status: DocumentStatus | "";
  from: string;
  to: string;
  min_amount?: string;
  max_amount?: string;
}

export interface CustomerSummary {
  documents: DocumentRecord[];
  unpaid: DocumentRecord[];
  paid_total: number;
  balance_total: number;
}

export type ManagedFileExtension = ".doc" | ".docx" | ".pdf" | ".xls" | ".xlsx";

export interface FileCategoryRecord {
  id: number;
  name: string;
  sort_order: number;
  file_count: number;
}

export interface ManagedFileRecord {
  id: number;
  display_name: string;
  original_name: string;
  extension: ManagedFileExtension;
  category_id: number;
  category_name: string;
  size_bytes: number;
  created_at: string;
}

export interface DailyIncomeRecord {
  id: number;
  business_date: string;
  opening_amount: number;
  closing_amount: number;
  daily_income: number;
  updated_at: string;
}

export interface AppApi {
  getBusinessSettings(): Promise<BusinessSettings>;
  saveBusinessSettings(value: BusinessSettings): Promise<BusinessSettings>;
  getTaxSettings(): Promise<TaxSettings>;
  saveTaxSettings(value: TaxSettings): Promise<TaxSettings>;
  getSequences(): Promise<Array<{ type: DocumentType; prefix: string; start_number: number }>>;
  saveSequences(values: Array<{ type: DocumentType; prefix: string; start_number: number }>): Promise<void>;
  chooseImage(): Promise<string | null>;
  listCustomers(search: string): Promise<Customer[]>;
  saveCustomer(value: Partial<Customer>): Promise<Customer>;
  customerSummary(id: number): Promise<CustomerSummary>;
  listDocuments(filters: DocumentFilters): Promise<DocumentRecord[]>;
  getDocument(id: number): Promise<DocumentRecord | null>;
  getRelatedDocuments(id: number): Promise<Array<DocumentRecord & { relation_type: string; direction: "INCOMING" | "OUTGOING" }>>;
  saveDocument(value: DocumentDraft): Promise<DocumentRecord>;
  issueDocument(id: number): Promise<DocumentRecord>;
  convertProforma(id: number): Promise<DocumentRecord>;
  cancelDocument(id: number, reason: string): Promise<void>;
  duplicateDocument(id: number): Promise<DocumentRecord>;
  setQuoteStatus(id: number, status: "ACCEPTED" | "REJECTED"): Promise<void>;
  addPayment(value: { invoice_id: number; amount: number; method: string; date: string }): Promise<DocumentRecord>;
  getHistory(id: number): Promise<Array<{ action: string; reason: string; created_at: string }>>;
  printDocument(id: number, exportPdf: boolean): Promise<string | null>;
  openDocumentWord(id: number): Promise<void>;
  createBackup(): Promise<string | null>;
  restoreBackup(): Promise<void>;
  openDataFolder(): Promise<void>;
  listFiles(search: string, categoryId: number | null): Promise<ManagedFileRecord[]>;
  listFileCategories(): Promise<FileCategoryRecord[]>;
  addFileCategory(name: string): Promise<FileCategoryRecord>;
  reorderFileCategories(ids: number[]): Promise<void>;
  uploadFile(displayName: string, categoryId: number): Promise<ManagedFileRecord | null>;
  renameFile(id: number, displayName: string): Promise<ManagedFileRecord>;
  setFileCategory(id: number, categoryId: number): Promise<ManagedFileRecord>;
  downloadFile(id: number): Promise<string | null>;
  openFile(id: number): Promise<void>;
  listDailyIncome(): Promise<DailyIncomeRecord[]>;
  saveDailyIncome(value: Pick<DailyIncomeRecord, "business_date" | "opening_amount" | "closing_amount">): Promise<DailyIncomeRecord>;
}

declare global {
  interface Window {
    appApi: AppApi;
  }
}
