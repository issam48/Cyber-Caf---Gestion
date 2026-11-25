import { useEffect, useMemo, useState } from "react";
import {
  Archive, ArrowDown, ArrowLeftRight, ArrowUp, BadgeDollarSign, Banknote, Building2, Check,
  ChevronDown, CirclePlus, ClipboardList, Download, ExternalLink, FileClock, FilePlus2,
  FileText, FileUp, FolderOpen, Gauge, History, ImagePlus, Landmark, Printer, ReceiptText,
  RotateCcw, Save, Search, Settings, ShieldCheck, Trash2, Users, X,
} from "lucide-react";
import type {
  BusinessSettings, Customer, CustomerSummary, DailyIncomeRecord, DocumentDraft, DocumentFilters, DocumentItem,
  DocumentRecord, DocumentType, FileCategoryRecord, ManagedFileRecord, TaxSettings,
} from "../shared/types";

type Page = "dashboard" | "documents" | "customers" | "income" | "shop" | "tax" | "backup" | "files";
type LineDraft = DocumentDraft["items"][number];
const emptyBusiness: BusinessSettings = {
  name: "", address: "", phone: "", email: "", website: "", rc: "", nif: "", nis: "", ai: "",
  bank_info: "", footer: "", logo_path: "", signature_path: "",
};
const types: Array<{ value: DocumentType; label: string }> = [
  { value: "INVOICE", label: "فاتورة" }, { value: "PROFORMA", label: "فاتورة أولية" },
  { value: "QUOTE", label: "عرض سعر" }, { value: "PURCHASE_ORDER", label: "طلب شراء" },
  { value: "RECEIPT", label: "إيصال دفع" }, { value: "CREDIT_NOTE", label: "إشعار دائن" },
];
const statusNames: Record<string, string> = {
  DRAFT: "مسودة", ISSUED: "صادر", CONVERTED: "تم التحويل", CANCELLED: "ملغى",
  ACCEPTED: "مقبول", REJECTED: "مرفوض", PENDING: "قيد الانتظار",
};
const money = (n: number) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const dateToday = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): LineDraft => ({ description: "", quantity: 1, unit_price: 0, discount: 0, tax_rate: null });
const customerBlank = () => ({ name: "", address: "", phone: "", email: "", nif: "", notes: "" });

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [business, setBusiness] = useState<BusinessSettings>(emptyBusiness);
  const [tax, setTax] = useState<TaxSettings>({ enabled: false, default_rate: null, price_mode: "HT" });
  const [sequences, setSequences] = useState<Array<{ type: DocumentType; prefix: string; start_number: number }>>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [filters, setFilters] = useState<DocumentFilters>({ search: "", type: "", status: "", from: "", to: "", min_amount: "", max_amount: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [showDocumentForm, setShowDocumentForm] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<DocumentRecord | null>(null);
  const [history, setHistory] = useState<Array<{ action: string; reason: string; created_at: string }>>([]);
  const [relatedDocuments, setRelatedDocuments] = useState<Array<DocumentRecord & { relation_type: string; direction: "INCOMING" | "OUTGOING" }>>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSummary, setCustomerSummary] = useState<CustomerSummary | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerForm, setCustomerForm] = useState(customerBlank());
  const [editingCustomer, setEditingCustomer] = useState<number | null>(null);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<DocumentRecord | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Espèces");
  const [cancelTarget, setCancelTarget] = useState<DocumentRecord | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [customerDocuments, setCustomerDocuments] = useState<DocumentRecord[]>([]);
  const [managedFiles, setManagedFiles] = useState<ManagedFileRecord[]>([]);
  const [fileCategories, setFileCategories] = useState<FileCategoryRecord[]>([]);
  const [fileQuery, setFileQuery] = useState("");
  const [fileCategoryFilter, setFileCategoryFilter] = useState("");
  const [fileDisplayName, setFileDisplayName] = useState("");
  const [uploadCategoryId, setUploadCategoryId] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [fileSort, setFileSort] = useState<"newest" | "name">("newest");

  async function loadAll() {
    setLoading(true);
    try {
      const [b, t, s, c, d] = await Promise.all([
        window.appApi.getBusinessSettings(), window.appApi.getTaxSettings(), window.appApi.getSequences(),
        window.appApi.listCustomers(customerQuery), window.appApi.listDocuments(filters),
      ]);
      setBusiness(b); setTax(t); setSequences(s); setCustomers(c); setDocuments(d); setError("");
    } catch (reason) { setError(messageOf(reason)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadAll(); }, []);
  useEffect(() => {
    if (page !== "documents" && page !== "customers" && page !== "dashboard") return;
    const timer = window.setTimeout(() => {
      Promise.all([window.appApi.listCustomers(customerQuery), window.appApi.listDocuments(filters)])
        .then(([c, d]) => { setCustomers(c); setDocuments(d); })
        .catch((reason) => setError(messageOf(reason)));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [filters, customerQuery, page]);
  useEffect(() => {
    if (page !== "files") return;
    const timer = window.setTimeout(() => {
      Promise.all([
        window.appApi.listFileCategories(),
        window.appApi.listFiles(fileQuery, fileCategoryFilter ? Number(fileCategoryFilter) : null),
      ]).then(([categories, files]) => {
        setFileCategories(categories);
        setManagedFiles(files);
        setUploadCategoryId((current) => current || String(categories[0]?.id ?? ""));
      }).catch((reason) => setError(messageOf(reason)));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [fileQuery, fileCategoryFilter, page]);

  function messageOf(reason: unknown) {
    return reason instanceof Error ? reason.message : String(reason);
  }
  async function run<T>(operation: () => Promise<T>, success?: string): Promise<T | undefined> {
    try {
      const value = await operation();
      setError("");
      if (success) setNotice(success);
      return value;
    } catch (reason) { setError(messageOf(reason)); return undefined; }
  }
  async function saveBusiness() {
    const saved = await run(() => window.appApi.saveBusinessSettings(business), "تم حفظ معلومات المحل.");
    if (saved) setBusiness(saved);
  }
  async function saveTax() {
    const saved = await run(() => window.appApi.saveTaxSettings(tax), "تم حفظ إعدادات TVA.");
    if (saved) setTax(saved);
  }
  async function saveSequenceSettings() {
    const saved = await run(() => window.appApi.saveSequences(sequences), "تم حفظ إعدادات الترقيم.");
    if (saved !== undefined) setSequences(await window.appApi.getSequences());
  }
  async function chooseImage(field: "logo_path" | "signature_path") {
    const file = await run(() => window.appApi.chooseImage());
    if (file) setBusiness((value) => ({ ...value, [field]: file }));
  }
  async function openDocument(id: number) {
    const record = await run(() => window.appApi.getDocument(id));
    if (record) {
      setSelectedDocument(record);
      setHistory(await window.appApi.getHistory(id));
      setRelatedDocuments(await window.appApi.getRelatedDocuments(id));
    }
  }
  async function refreshDocuments() {
    setDocuments(await window.appApi.listDocuments(filters));
    setCustomers(await window.appApi.listCustomers(customerQuery));
    if (selectedDocument) {
      const updated = await window.appApi.getDocument(selectedDocument.id);
      setSelectedDocument(updated);
      setRelatedDocuments(await window.appApi.getRelatedDocuments(selectedDocument.id));
    }
  }
  async function actAndRefresh(operation: () => Promise<unknown>, success: string) {
    const result = await run(operation, success);
    if (result !== undefined) await refreshDocuments();
  }
  async function saveCustomerForm() {
    const saved = await run(() => window.appApi.saveCustomer({ ...customerForm, id: editingCustomer ?? undefined }), "تم حفظ بيانات العميل.");
    if (saved) {
      setShowCustomerForm(false); setCustomerForm(customerBlank()); setEditingCustomer(null);
      setCustomers(await window.appApi.listCustomers(customerQuery));
      if (selectedCustomer?.id === saved.id) setSelectedCustomer(saved);
    }
  }
  async function selectCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setCustomerSummary(await window.appApi.customerSummary(customer.id));
    setCustomerDocuments((await window.appApi.listDocuments({ search: customer.name, type: "", status: "", from: "", to: "" }))
      .filter((document) => document.customer_id === customer.id));
  }
  async function uploadManagedFile() {
    if (!uploadCategoryId) {
      setError("أضف تصنيفاً قبل رفع الملفات.");
      return;
    }
    const file = await run(() => window.appApi.uploadFile(fileDisplayName, Number(uploadCategoryId)));
    if (file) {
      setFileDisplayName("");
      setManagedFiles(await window.appApi.listFiles(fileQuery, fileCategoryFilter ? Number(fileCategoryFilter) : null));
      setNotice("تم حفظ الملف محلياً.");
    }
  }
  async function renameManagedFile(id: number, displayName: string) {
    const file = await run(() => window.appApi.renameFile(id, displayName));
    if (file) {
      setManagedFiles(await window.appApi.listFiles(fileQuery, fileCategoryFilter ? Number(fileCategoryFilter) : null));
      setNotice("تم تحديث اسم الملف.");
      return true;
    }
    return false;
  }
  async function setManagedFileCategory(id: number, categoryId: number) {
    const file = await run(() => window.appApi.setFileCategory(id, categoryId));
    if (file) setManagedFiles(await window.appApi.listFiles(fileQuery, fileCategoryFilter ? Number(fileCategoryFilter) : null));
  }
  async function addFileCategory() {
    const category = await run(() => window.appApi.addFileCategory(newCategoryName), "تمت إضافة التصنيف.");
    if (category) {
      setNewCategoryName("");
      setFileCategories(await window.appApi.listFileCategories());
      setUploadCategoryId(String(category.id));
    }
  }
  async function reorderFileCategories(ids: number[]) {
    try {
      await window.appApi.reorderFileCategories(ids);
      setFileCategories(await window.appApi.listFileCategories());
      setError("");
    } catch (reason) { setError(messageOf(reason)); }
  }
  async function downloadManagedFile(id: number) {
    const destination = await run(() => window.appApi.downloadFile(id));
    if (destination) setNotice(`تم حفظ نسخة الملف في: ${destination}`);
  }
  async function openManagedFile(id: number) {
    await run(() => window.appApi.openFile(id));
  }

  const counts = useMemo(() => ({
    invoices: documents.filter((d) => d.type === "INVOICE").length,
    open: documents.filter((d) => d.type === "INVOICE" && d.balance > 0.005 && d.status !== "CANCELLED").length,
    customers: customers.length,
    due: documents.filter((d) => d.type === "INVOICE" && d.status !== "CANCELLED").reduce((sum, d) => sum + d.balance, 0),
  }), [documents, customers]);

  const nav: Array<{ key: Page; label: string; icon: typeof Gauge }> = [
    { key: "dashboard", label: "الرئيسية", icon: Gauge },
    { key: "documents", label: "المستندات", icon: Archive },
    { key: "customers", label: "العملاء", icon: Users },
    { key: "income", label: "الدخل اليومي", icon: Banknote },
    { key: "shop", label: "معلومات المحل", icon: Building2 },
    { key: "tax", label: "الضرائب والترقيم", icon: Settings },
    { key: "files", label: "الملفات", icon: FolderOpen },
    { key: "backup", label: "النسخ الاحتياطي", icon: ShieldCheck },
  ];

  return <div className="app-shell" dir="rtl">
    <aside className="sidebar">
      <div className="brand-lockup"><div className="brand-icon"><Building2 size={22} /></div><div><strong>مقهى الأعمال</strong><small>إدارة محلية آمنة</small></div></div>
      <div className="nav-caption">القائمة الرئيسية</div>
      <nav>{nav.map(({ key, label, icon: Icon }) => <button key={key} className={`nav-item ${page === key ? "active" : ""}`} onClick={() => setPage(key)}><Icon size={18} /><span>{label}</span>{page === key && <span className="nav-indicator" />}</button>)}</nav>
      <div className="sidebar-bottom"><span className="offline-dot" /> يعمل دون اتصال بالإنترنت</div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><div className="breadcrumb">إدارة المقهى <span>/</span> {nav.find((item) => item.key === page)?.label}</div><h1>{pageTitle(page)}</h1></div>
        <div className="topbar-actions"><div className="today-pill">{new Intl.DateTimeFormat("ar-DZ", { dateStyle: "long" }).format(new Date())}</div><button className="avatar" title="معلومات المحل" onClick={() => setPage("shop")}>{business.name ? business.name.slice(0, 1) : "م"}</button></div>
      </header>
      <section className="content">
        {error && <div className="alert error"><X size={18} /><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
        {notice && <div className="alert success"><Check size={18} /><span>{notice}</span><button onClick={() => setNotice("")}><X size={16} /></button></div>}
        {loading ? <div className="loading">جارٍ تحميل البيانات المحلية…</div> : <>
          {page === "dashboard" && <Dashboard counts={counts} documents={documents.slice(0, 6)} go={setPage} onOpen={openDocument} onNew={() => setShowDocumentForm(true)} />}
          {page === "documents" && <DocumentsPage documents={documents} filters={filters} setFilters={setFilters}
            onNew={() => setShowDocumentForm(true)} onOpen={openDocument} onPayment={setPaymentTarget}
            onCancel={setCancelTarget} onRefresh={refreshDocuments}
            onAct={actAndRefresh} onError={(message) => setError(message)} />}
          {page === "customers" && <CustomersPage customers={customers} selected={selectedCustomer} summary={customerSummary}
            customerDocuments={customerDocuments} query={customerQuery} setQuery={setCustomerQuery}
            onSelect={selectCustomer} onNew={() => { setCustomerForm(customerBlank()); setEditingCustomer(null); setShowCustomerForm(true); }}
            onEdit={(c) => { setCustomerForm({ name: c.name, address: c.address, phone: c.phone, email: c.email, nif: c.nif, notes: c.notes }); setEditingCustomer(c.id); setShowCustomerForm(true); }}
            onOpen={openDocument} />}
          {page === "income" && <DailyIncomePage onError={(message) => setError(message)} onNotice={(message) => setNotice(message)} />}
          {page === "shop" && <ShopSettings business={business} setBusiness={setBusiness} onSave={saveBusiness} onImage={chooseImage} />}
          {page === "tax" && <TaxSettingsPage tax={tax} setTax={setTax} sequences={sequences} setSequences={setSequences} onSaveTax={saveTax} onSaveSequences={saveSequenceSettings} />}
          {page === "files" && <FilesPage files={managedFiles} categories={fileCategories} query={fileQuery}
            setQuery={setFileQuery} categoryFilter={fileCategoryFilter} setCategoryFilter={setFileCategoryFilter}
            displayName={fileDisplayName} setDisplayName={setFileDisplayName} uploadCategoryId={uploadCategoryId}
            setUploadCategoryId={setUploadCategoryId} newCategoryName={newCategoryName} setNewCategoryName={setNewCategoryName}
            sort={fileSort} setSort={setFileSort} onUpload={uploadManagedFile} onAddCategory={addFileCategory}
            onReorderCategories={reorderFileCategories} onRename={renameManagedFile}
            onSetCategory={setManagedFileCategory} onDownload={downloadManagedFile} onOpen={openManagedFile} />}
          {page === "backup" && <BackupPage onError={(message) => setError(message)} onNotice={setNotice} />}
        </>}
      </section>
    </main>
    {showDocumentForm && <DocumentForm tax={tax} customers={customers} documents={documents} onClose={() => setShowDocumentForm(false)}
      onSave={async (draft) => {
        const doc = await run(() => window.appApi.saveDocument(draft), draft.issue_now ? "تم إصدار المستند وحفظه." : "تم حفظ المسودة.");
        if (doc) { setShowDocumentForm(false); await refreshDocuments(); setSelectedDocument(doc); }
      }}
      onCreateCustomer={async (name) => {
        const customer = await run(() => window.appApi.saveCustomer({ ...customerBlank(), name }), "تمت إضافة العميل.");
        if (customer) { setCustomers(await window.appApi.listCustomers("")); return customer; }
        return null;
      }} />}
    {showCustomerForm && <CustomerForm value={customerForm} setValue={setCustomerForm} onSave={saveCustomerForm} onClose={() => setShowCustomerForm(false)} />}
    {selectedDocument && <DocumentDetails document={selectedDocument} history={history} relatedDocuments={relatedDocuments} onOpenRelated={openDocument} onClose={() => setSelectedDocument(null)}
      onPrint={(exportPdf) => run(() => window.appApi.printDocument(selectedDocument.id, exportPdf), exportPdf ? "تم تصدير PDF." : "تم إرسال المستند للطباعة.")}
      onIssue={() => actAndRefresh(() => window.appApi.issueDocument(selectedDocument.id), "تم إصدار المستند.")}
      onConvert={() => actAndRefresh(() => window.appApi.convertProforma(selectedDocument.id), "تم تحويل الفاتورة الأولية إلى فاتورة.")}
      onDuplicate={async () => {
        const copy = await run(() => window.appApi.duplicateDocument(selectedDocument.id), "تم إنشاء مسودة جديدة.");
        if (copy) { setSelectedDocument(copy); await refreshDocuments(); }
      }}
      onPayment={() => setPaymentTarget(selectedDocument)}
      onCancel={() => setCancelTarget(selectedDocument)}
      onQuoteStatus={(status) => actAndRefresh(() => window.appApi.setQuoteStatus(selectedDocument.id, status), "تم تحديث حالة عرض السعر.")} />}
    {paymentTarget && <PaymentDialog document={paymentTarget} onClose={() => setPaymentTarget(null)} onSave={async (value) => {
      const result = await run(() => window.appApi.addPayment(value), "تم تسجيل الدفعة وإنشاء إيصال.");
      if (result) { setPaymentTarget(null); await refreshDocuments(); }
    }} />}
    {cancelTarget && <CancelDialog reason={cancelReason} setReason={setCancelReason} onClose={() => { setCancelTarget(null); setCancelReason(""); }}
      onSave={async () => {
        const result = await run(() => window.appApi.cancelDocument(cancelTarget.id, cancelReason), "تم إلغاء المستند وحفظه في الأرشيف.");
        if (result !== undefined) { setCancelTarget(null); setCancelReason(""); await refreshDocuments(); }
      }} />}
  </div>;
}

function pageTitle(page: Page) {
  return ({ dashboard: "لوحة التحكم", documents: "إدارة المستندات", customers: "قاعدة بيانات العملاء", income: "حساب الدخل اليومي", shop: "معلومات المحل", tax: "الضرائب والترقيم", backup: "النسخ الاحتياطي", files: "الملفات" })[page];
}

function Dashboard({ counts, documents, go, onOpen, onNew }: {
  counts: { invoices: number; open: number; customers: number; due: number };
  documents: DocumentRecord[]; go: (page: Page) => void; onOpen: (id: number) => void; onNew: () => void;
}) {
  return <div className="stack">
    <div className="welcome-panel"><div><span className="eyebrow">نظرة عامة</span><h2>مرحباً بك في إدارة أعمالك</h2><p>أنشئ المستندات، تابع العملاء، واحتفظ ببياناتك بأمان على جهازك.</p></div><button className="button primary" onClick={onNew}><FilePlus2 size={17} /> مستند جديد</button></div>
    <div className="stats-grid">
      <Stat icon={FileText} label="إجمالي الفواتير" value={String(counts.invoices)} tone="teal" />
      <Stat icon={BadgeDollarSign} label="فواتير غير مسددة" value={String(counts.open)} tone="amber" />
      <Stat icon={Users} label="العملاء" value={String(counts.customers)} tone="blue" />
      <Stat icon={Banknote} label="الرصيد المستحق" value={`${money(counts.due)} دج`} tone="violet" />
    </div>
    <div className="panel"><div className="panel-heading"><div><h3>أحدث المستندات</h3><p>آخر المستندات المحفوظة محلياً</p></div><button className="button subtle" onClick={() => go("documents")}>عرض الأرشيف <ChevronDown size={16} /></button></div>
      <DocumentTable documents={documents} onOpen={onOpen} compact /></div>
    <div className="quick-grid">
      <button className="quick-card" onClick={onNew}><span className="quick-icon teal-bg"><FilePlus2 size={20} /></span><span><b>إنشاء مستند</b><small>فاتورة، عرض سعر أو إيصال</small></span><ChevronDown size={17} /></button>
      <button className="quick-card" onClick={() => go("customers")}><span className="quick-icon blue-bg"><Users size={20} /></span><span><b>إدارة العملاء</b><small>الملفات، الأرصدة وسجل الدفع</small></span><ChevronDown size={17} /></button>
      <button className="quick-card" onClick={() => go("backup")}><span className="quick-icon violet-bg"><ShieldCheck size={20} /></span><span><b>حماية البيانات</b><small>إنشاء نسخة احتياطية قابلة للاستعادة</small></span><ChevronDown size={17} /></button>
    </div>
  </div>;
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Gauge; label: string; value: string; tone: string }) {
  return <div className="stat-card"><span className={`stat-icon ${tone}`}><Icon size={20} /></span><div><span className="stat-label">{label}</span><strong>{value}</strong></div></div>;
}

function DailyIncomePage({ onError, onNotice }: { onError: (message: string) => void; onNotice: (message: string) => void }) {
  const [records, setRecords] = useState<DailyIncomeRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => {
    const date = new Date();
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  });
  const [openingAmount, setOpeningAmount] = useState("");
  const [closingAmount, setClosingAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const existing = records.find((record) => record.business_date === selectedDate);
  const opening = Number(openingAmount);
  const closing = Number(closingAmount);
  const calculatedIncome = openingAmount !== "" && closingAmount !== "" &&
    Number.isFinite(opening) && Number.isFinite(closing) ? closing - opening : null;

  function getErrorMessage(reason: unknown) {
    return reason instanceof Error ? reason.message : String(reason);
  }

  useEffect(() => {
    window.appApi.listDailyIncome().then((items) => {
      setRecords(items);
      const current = items.find((record) => record.business_date === selectedDate);
      if (current) {
        setOpeningAmount(String(current.opening_amount));
        setClosingAmount(String(current.closing_amount));
      }
    }).catch((reason) => onError(getErrorMessage(reason)));
  }, []);

  function chooseDate(date: string) {
    setSelectedDate(date);
    const record = records.find((item) => item.business_date === date);
    setOpeningAmount(record ? String(record.opening_amount) : "");
    setClosingAmount(record ? String(record.closing_amount) : "");
  }

  async function save() {
    if (!selectedDate || openingAmount === "" || closingAmount === "" ||
        !Number.isFinite(opening) || !Number.isFinite(closing) || opening < 0 || closing < 0) {
      onError("أدخل التاريخ ومبلغي بداية اليوم ونهايته بشكل صحيح.");
      return;
    }
    setSaving(true);
    try {
      const saved = await window.appApi.saveDailyIncome({
        business_date: selectedDate,
        opening_amount: opening,
        closing_amount: closing,
      });
      setRecords((items) => [saved, ...items.filter((item) => item.business_date !== saved.business_date)]
        .sort((a, b) => b.business_date.localeCompare(a.business_date)).slice(0, 366));
      setOpeningAmount(String(saved.opening_amount));
      setClosingAmount(String(saved.closing_amount));
      onError("");
      onNotice("تم حفظ حساب دخل اليوم.");
    } catch (reason) {
      onError(getErrorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return <div className="daily-income-layout">
    <div className="panel settings-panel daily-income-form">
      <div className="panel-heading"><div><h3>تسجيل دخل اليوم</h3><p>أدخل المبلغ الموجود في بداية اليوم ونهايته لحساب الفرق تلقائياً.</p></div><span className="soft-icon teal-icon"><Banknote size={20} /></span></div>
      <div className="daily-income-fields">
        <Field label="التاريخ"><input type="date" value={selectedDate} onChange={(event) => chooseDate(event.target.value)} /></Field>
        <Field label="المدخول في بداية اليوم (دج)"><input type="number" min="0" step="0.01" value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} placeholder="0.00" /></Field>
        <Field label="المدخول في نهاية اليوم (دج)"><input type="number" min="0" step="0.01" value={closingAmount} onChange={(event) => setClosingAmount(event.target.value)} placeholder="0.00" /></Field>
      </div>
      <div className="daily-income-result">
        <span>{calculatedIncome !== null && calculatedIncome < 0 ? "الفرق بين بداية اليوم ونهايته" : "دخل اليوم (نهاية اليوم − بداية اليوم)"}</span>
        <strong>{calculatedIncome === null ? "—" : `${money(calculatedIncome)} دج`}</strong>
      </div>
      <div className="form-footer"><span className="muted-text">{existing ? "يوجد سجل لهذا التاريخ؛ حفظ التغييرات سيحدّثه." : "يُحفظ سجل واحد لكل تاريخ ويمكن تعديله لاحقاً."}</span>
        <button className="button primary" onClick={() => void save()} disabled={saving}><Save size={17} /> {saving ? "جارٍ الحفظ…" : existing ? "تحديث سجل اليوم" : "حفظ سجل اليوم"}</button></div>
    </div>
    <div className="panel">
      <div className="panel-heading"><div><h3>سجل الدخل اليومي</h3><p>آخر 366 يوماً مسجلاً</p></div><span className="mini-badge"><History size={14} /> محفوظ محلياً</span></div>
      {records.length === 0 ? <div className="empty-state"><Banknote size={25} /><b>لا توجد سجلات دخل بعد</b><span>أدخل مبالغ بداية اليوم ونهايته ثم احفظ السجل.</span></div> :
        <div className="daily-income-history">
          <div className="daily-income-history-head"><span>التاريخ</span><span>بداية اليوم</span><span>نهاية اليوم</span><span>دخل اليوم</span></div>
          {records.map((record) => <button key={record.id} className={`daily-income-history-row ${record.business_date === selectedDate ? "selected" : ""}`} onClick={() => chooseDate(record.business_date)}>
            <span>{formatDate(record.business_date)}</span><span>{money(record.opening_amount)} دج</span><span>{money(record.closing_amount)} دج</span>
            <b>{money(record.daily_income)} دج</b>
          </button>)}
        </div>}
    </div>
  </div>;
}

function DocumentsPage({ documents, filters, setFilters, onNew, onOpen, onPayment, onCancel, onRefresh, onAct, onError }: {
  documents: DocumentRecord[]; filters: DocumentFilters; setFilters: (value: DocumentFilters) => void;
  onNew: () => void; onOpen: (id: number) => void; onPayment: (document: DocumentRecord) => void;
  onCancel: (document: DocumentRecord) => void; onRefresh: () => Promise<void>;
  onAct: (operation: () => Promise<unknown>, success: string) => Promise<void>; onError: (message: string) => void;
}) {
  const patch = (value: Partial<DocumentFilters>) => setFilters({ ...filters, ...value });
  return <div className="stack"><div className="toolbar"><div className="search-box"><Search size={17} /><input placeholder="ابحث برقم المستند أو اسم العميل…" value={filters.search} onChange={(e) => patch({ search: e.target.value })} /></div>
    <button className="button primary" onClick={onNew}><CirclePlus size={17} /> إنشاء مستند</button></div>
    <div className="filter-bar">
      <select value={filters.type} onChange={(e) => patch({ type: e.target.value as DocumentType | "" })}><option value="">كل الأنواع</option>{types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
      <select value={filters.status} onChange={(e) => patch({ status: e.target.value as DocumentFilters["status"] })}><option value="">كل الحالات</option>{Object.entries(statusNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <label>من <input type="date" value={filters.from} onChange={(e) => patch({ from: e.target.value })} /></label>
      <label>إلى <input type="date" value={filters.to} onChange={(e) => patch({ to: e.target.value })} /></label>
      <label>من مبلغ <input type="number" min="0" placeholder="دج" value={filters.min_amount ?? ""} onChange={(e) => patch({ min_amount: e.target.value })} /></label>
      <label>إلى مبلغ <input type="number" min="0" placeholder="دج" value={filters.max_amount ?? ""} onChange={(e) => patch({ max_amount: e.target.value })} /></label>
      <button className="button subtle" onClick={() => setFilters({ search: "", type: "", status: "", from: "", to: "", min_amount: "", max_amount: "" })}><RotateCcw size={15} /> مسح الفلاتر</button>
    </div>
    <div className="panel"><div className="panel-heading"><div><h3>أرشيف المستندات</h3><p>{documents.length} مستند · لا يمكن حذف المستندات الصادرة نهائياً</p></div><span className="mini-badge"><Archive size={14} /> محفوظ محلياً</span></div>
      <DocumentTable documents={documents} onOpen={onOpen} onPayment={onPayment} onCancel={onCancel} onAct={onAct} onError={onError} onRefresh={onRefresh} /></div>
  </div>;
}

function DocumentTable({ documents, onOpen, compact = false, onPayment, onCancel, onAct, onError, onRefresh }: {
  documents: DocumentRecord[]; onOpen: (id: number) => void; compact?: boolean;
  onPayment?: (document: DocumentRecord) => void; onCancel?: (document: DocumentRecord) => void;
  onAct?: (operation: () => Promise<unknown>, success: string) => Promise<void>;
  onError?: (message: string) => void; onRefresh?: () => Promise<void>;
}) {
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>رقم المستند</th><th>النوع</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th>{!compact && <><th>الدفع</th><th>الحالة</th></>}<th></th></tr></thead><tbody>
    {documents.length === 0 ? <tr><td colSpan={compact ? 6 : 8}><div className="empty-state"><FileText size={25} /><b>لا توجد مستندات</b><span>ستظهر المستندات هنا بعد إنشائها.</span></div></td></tr> : documents.map((document) => {
      const customer = safeCustomer(document.customer_snapshot);
      return <tr key={document.id} onDoubleClick={() => onOpen(document.id)}>
        <td><button className="link-button" onClick={() => onOpen(document.id)}>{document.number ?? "مسودة"}</button></td>
        <td>{typeLabel(document.type)}</td><td className="customer-cell">{customer.name || "عميل غير محدد"}</td>
        <td>{formatDate(document.issue_date)}</td><td className="amount-cell">{money(document.total_ttc)} دج</td>
        {!compact && <><td><span className={`payment-pill ${document.balance <= 0.005 ? "paid" : document.paid_amount > 0 ? "partial" : "unpaid"}`}>{document.balance <= 0.005 ? "مسدد" : document.paid_amount > 0 ? "جزئي" : document.type === "INVOICE" ? "غير مسدد" : "—"}</span></td>
          <td><span className={`status-pill status-${document.status.toLowerCase()}`}>{statusNames[document.status] ?? document.status}</span></td></>}
        <td><div className="row-actions">
          <button title="عرض التفاصيل" onClick={() => onOpen(document.id)}><FolderOpen size={16} /></button>
          {!compact && document.type === "INVOICE" && document.status === "ISSUED" && document.balance > 0.005 && <button title="تسجيل دفعة" onClick={() => onPayment?.(document)}><Banknote size={16} /></button>}
          {!compact && document.status !== "DRAFT" && document.status !== "CANCELLED" && <button title="إلغاء المستند" onClick={() => onCancel?.(document)}><X size={16} /></button>}
          {!compact && <button title="تصدير PDF" onClick={async () => {
            try { await window.appApi.printDocument(document.id, true); } catch (reason) { onError?.(reason instanceof Error ? reason.message : String(reason)); }
          }}><Printer size={16} /></button>}
        </div></td>
      </tr>;
    })}</tbody></table></div>;
}

function ShopSettings({ business, setBusiness, onSave, onImage }: {
  business: BusinessSettings; setBusiness: (value: BusinessSettings) => void;
  onSave: () => void; onImage: (field: "logo_path" | "signature_path") => void;
}) {
  const field = (key: keyof BusinessSettings, value: string) => setBusiness({ ...business, [key]: value });
  return <div className="settings-layout"><div className="panel settings-panel"><div className="panel-heading"><div><h3>بيانات النشاط التجاري</h3><p>يمكنك إكمال أو تعديل هذه المعلومات في أي وقت.</p></div><span className="soft-icon"><Building2 size={20} /></span></div>
    <div className="form-grid">
      <Field label="اسم المحل"><input value={business.name} onChange={(e) => field("name", e.target.value)} placeholder="اسم النشاط التجاري" /></Field>
      <Field label="رقم الهاتف"><input value={business.phone} onChange={(e) => field("phone", e.target.value)} placeholder="+213 ..." /></Field>
      <Field label="العنوان" wide><input value={business.address} onChange={(e) => field("address", e.target.value)} placeholder="العنوان الكامل" /></Field>
      <Field label="البريد الإلكتروني"><input type="email" value={business.email} onChange={(e) => field("email", e.target.value)} placeholder="contact@example.dz" /></Field>
      <Field label="الموقع الإلكتروني (اختياري)"><input value={business.website} onChange={(e) => field("website", e.target.value)} placeholder="www.example.dz" /></Field>
    </div></div>
    <div className="panel settings-panel"><div className="panel-heading"><div><h3>المعرفات القانونية</h3><p>تُحفظ في لقطة المستندات عند الإصدار.</p></div><span className="soft-icon amber-icon"><Landmark size={20} /></span></div>
      <div className="form-grid">
        <Field label="السجل التجاري RC"><input value={business.rc} onChange={(e) => field("rc", e.target.value)} /></Field>
        <Field label="رقم التعريف الجبائي NIF"><input value={business.nif} onChange={(e) => field("nif", e.target.value)} /></Field>
        <Field label="رقم التعريف الإحصائي NIS"><input value={business.nis} onChange={(e) => field("nis", e.target.value)} /></Field>
        <Field label="رقم المادة AI"><input value={business.ai} onChange={(e) => field("ai", e.target.value)} /></Field>
        <Field label="المعلومات البنكية (اختياري)" wide><textarea rows={2} value={business.bank_info} onChange={(e) => field("bank_info", e.target.value)} /></Field>
      </div></div>
    <div className="panel settings-panel"><div className="panel-heading"><div><h3>الشعار والتوقيع</h3><p>تُنسخ الصور إلى مجلد بيانات التطبيق المحلي.</p></div><ImagePlus size={20} className="muted-icon" /></div>
      <div className="upload-grid">{(["logo_path", "signature_path"] as const).map((key) => <div className="upload-card" key={key}>
        <div className="upload-preview">{business[key] ? <Check size={25} className="success-icon" /> : <ImagePlus size={24} />}</div>
        <div className="upload-info"><b>{key === "logo_path" ? "شعار المحل" : "التوقيع والختم"}</b><small>{business[key] ? "تم اختيار الملف وحفظه محلياً" : "اختياري · PNG أو JPG أو WEBP"}</small></div>
        <button className="button outline small" onClick={() => onImage(key)}>{business[key] ? "تغيير الصورة" : "اختيار صورة"}</button>
      </div>)}</div>
      <Field label="تذييل المستند الافتراضي" wide><textarea rows={3} value={business.footer} onChange={(e) => field("footer", e.target.value)} placeholder="عبارة أو شروط إضافية تظهر أسفل المستند…" /></Field>
    </div>
    <div className="form-footer"><span className="muted-text">الحقول الاختيارية لا تمنع حفظ الإعدادات. الاسم والعنوان والهاتف مطلوبة عند الإصدار.</span><button className="button primary" onClick={onSave}><Save size={17} /> حفظ معلومات المحل</button></div>
  </div>;
}

function TaxSettingsPage({ tax, setTax, sequences, setSequences, onSaveTax, onSaveSequences }: {
  tax: TaxSettings; setTax: (value: TaxSettings) => void;
  sequences: Array<{ type: DocumentType; prefix: string; start_number: number }>;
  setSequences: (value: Array<{ type: DocumentType; prefix: string; start_number: number }>) => void;
  onSaveTax: () => void; onSaveSequences: () => void;
}) {
  return <div className="settings-layout">
    <div className="panel settings-panel"><div className="panel-heading"><div><h3>إعدادات الضريبة على القيمة المضافة</h3><p>TVA اختيارية؛ لا تُحتسب إلا بعد تفعيلها وتحديد النسبة.</p></div><span className="soft-icon violet-icon"><BadgeDollarSign size={20} /></span></div>
      <div className="tax-toggle-row"><div><b>تطبيق TVA على المستندات الجديدة</b><small>لن تتأثر المستندات الصادرة سابقاً بتغيير هذا الإعداد.</small></div><button className={`toggle ${tax.enabled ? "on" : ""}`} role="switch" aria-checked={tax.enabled} onClick={() => setTax({ ...tax, enabled: !tax.enabled })}><span /></button></div>
      {tax.enabled && <div className="form-grid tax-fields">
        <Field label="النسبة الافتراضية (%)"><input type="number" min="0" max="100" step="0.01" value={tax.default_rate ?? ""} placeholder="غير محددة" onChange={(e) => setTax({ ...tax, default_rate: e.target.value === "" ? null : Number(e.target.value) })} /><small>يمكن تركها فارغة وتحديد نسبة مستقلة لكل بند.</small></Field>
        <Field label="طريقة إدخال الأسعار"><select value={tax.price_mode} onChange={(e) => setTax({ ...tax, price_mode: e.target.value as "HT" | "TTC" })}><option value="HT">الأسعار دون TVA (HT)</option><option value="TTC">الأسعار شاملة TVA (TTC)</option></select></Field>
      </div>}
      <div className="info-note"><ShieldCheck size={17} /><span>لا يتم افتراض خضوع نشاطك للضريبة ولا تعيين أي نسبة تلقائياً. عند تفعيل TVA يجب تحديد نسبة لكل بند أو إعداد نسبة افتراضية قبل إصدار المستند.</span></div>
      <div className="form-footer"><span /><button className="button primary" onClick={onSaveTax}><Save size={17} /> حفظ إعدادات TVA</button></div>
    </div>
    <div className="panel settings-panel"><div className="panel-heading"><div><h3>تسلسل أرقام المستندات</h3><p>سلسلة مستقلة لكل نوع وسنة، ولا يُعاد استخدام رقم مُصدر.</p></div><span className="soft-icon teal-icon"><FileClock size={20} /></span></div>
      <div className="sequence-list">{sequences.map((sequence) => <div className="sequence-row" key={sequence.type}><div className="sequence-name"><span>{typeLabel(sequence.type)}</span><small>{sequence.type}</small></div>
        <Field label="البادئة"><input value={sequence.prefix} onChange={(e) => setSequences(sequences.map((s) => s.type === sequence.type ? { ...s, prefix: e.target.value } : s))} /></Field>
        <Field label="رقم البداية"><input type="number" min="1" value={sequence.start_number} onChange={(e) => setSequences(sequences.map((s) => s.type === sequence.type ? { ...s, start_number: Number(e.target.value) } : s))} /></Field>
        <span className="sequence-preview">{sequence.prefix}-{new Date().getFullYear()}-{String(sequence.start_number).padStart(4, "0")}</span>
      </div>)}</div>
      <div className="info-note"><FileClock size={17} /><span>المسودات لا تستهلك رقماً. يُمنع تغيير البداية إلى رقم أقل من التسلسل المستخدم.</span></div>
      <div className="form-footer"><span /><button className="button primary" onClick={onSaveSequences}><Save size={17} /> حفظ إعدادات الترقيم</button></div>
    </div>
  </div>;
}

function CustomersPage({ customers, selected, summary, customerDocuments, query, setQuery, onSelect, onNew, onEdit, onOpen }: {
  customers: Customer[]; selected: Customer | null; summary: CustomerSummary | null; customerDocuments: DocumentRecord[];
  query: string; setQuery: (value: string) => void; onSelect: (customer: Customer) => void; onNew: () => void;
  onEdit: (customer: Customer) => void; onOpen: (id: number) => void;
}) {
  return <div className="customer-layout"><div className="panel customer-list-panel"><div className="panel-heading"><div><h3>العملاء</h3><p>{customers.length} عميل مسجل</p></div><button className="icon-button primary-icon" title="إضافة عميل" onClick={onNew}><CirclePlus size={18} /></button></div>
    <div className="search-box full"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث عن عميل…" /></div>
    <div className="customer-list">{customers.map((customer) => <button className={`customer-list-item ${selected?.id === customer.id ? "selected" : ""}`} key={customer.id} onClick={() => onSelect(customer)}>
      <span className="customer-avatar">{customer.name.slice(0, 1)}</span><span><b>{customer.name}</b><small>{customer.phone || customer.email || "لا توجد بيانات اتصال"}</small></span></button>)}
      {customers.length === 0 && <div className="empty-state"><Users size={23} /><span>لا يوجد عملاء مطابقون</span></div>}
    </div></div>
    <div className="customer-detail">{!selected ? <div className="panel customer-empty"><Users size={34} /><b>اختر عميلاً لعرض ملفه</b><span>سجل المستندات والمدفوعات والأرصدة.</span><button className="button outline" onClick={onNew}>إضافة عميل</button></div> : <>
      <div className="panel customer-profile"><div className="profile-header"><span className="profile-avatar">{selected.name.slice(0, 1)}</span><div><h2>{selected.name}</h2><p>{selected.address || "لا يوجد عنوان مسجل"}</p></div><button className="button outline small" onClick={() => onEdit(selected)}>تعديل البيانات</button></div>
        <div className="profile-contact"><span>{selected.phone || "—"}</span><span>{selected.email || "—"}</span><span>NIF: {selected.nif || "—"}</span></div>
      </div>
      <div className="customer-stats"><Stat icon={ClipboardList} label="عدد المستندات" value={String(customerDocuments.length)} tone="blue" /><Stat icon={BadgeDollarSign} label="الرصيد المستحق" value={`${money(summary?.balance_total ?? 0)} دج`} tone="amber" /><Stat icon={Banknote} label="إجمالي المدفوع" value={`${money(summary?.paid_total ?? 0)} دج`} tone="teal" /></div>
      <div className="panel"><div className="panel-heading"><div><h3>سجل المستندات</h3><p>الفواتير، عروض الأسعار والإيصالات المرتبطة بالعميل</p></div></div><DocumentTable documents={customerDocuments} onOpen={onOpen} compact /></div>
      <div className="panel compact-panel"><div className="panel-heading"><div><h3>الفواتير غير المسددة</h3><p>إجمالي المتبقي: {money(summary?.balance_total ?? 0)} دج</p></div><Banknote size={19} className="muted-icon" /></div>
        {!summary?.unpaid.length ? <div className="empty-inline">لا توجد فواتير مستحقة.</div> : summary.unpaid.map((invoice) => <button className="debt-row" key={invoice.id} onClick={() => onOpen(invoice.id)}><span>{invoice.number}</span><span>{formatDate(invoice.issue_date)}</span><b>{money(invoice.balance)} دج</b></button>)}
      </div>
    </>}</div></div>;
}

function DocumentForm({ tax, customers, documents, onClose, onSave, onCreateCustomer }: {
  tax: TaxSettings; customers: Customer[]; documents: DocumentRecord[]; onClose: () => void;
  onSave: (draft: DocumentDraft) => Promise<void>;
  onCreateCustomer: (name: string) => Promise<Customer | null>;
}) {
  const [type, setType] = useState<DocumentType>("INVOICE");
  const [customerId, setCustomerId] = useState("");
  const [relatedInvoiceId, setRelatedInvoiceId] = useState("");
  const [customer, setCustomer] = useState(customerBlank());
  const [date, setDate] = useState(dateToday());
  const [dueDate, setDueDate] = useState("");
  const [validity, setValidity] = useState("30");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineDraft[]>([emptyLine()]);
  const [issueNow, setIssueNow] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const selectedCustomer = customers.find((entry) => String(entry.id) === customerId);
  const totals = calculatePreview(items, tax);

  async function quickCustomer() {
    const name = customer.name.trim();
    if (!name) return;
    const saved = await onCreateCustomer(name);
    if (saved) { setCustomerId(String(saved.id)); setCustomer({ name: saved.name, address: saved.address, phone: saved.phone, email: saved.email, nif: saved.nif, notes: saved.notes }); setCreatingCustomer(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      await onSave({
        type, customer_id: customerId ? Number(customerId) : null,
        related_document_id: relatedInvoiceId ? Number(relatedInvoiceId) : null,
        customer: selectedCustomer ? { name: selectedCustomer.name, address: selectedCustomer.address, phone: selectedCustomer.phone, email: selectedCustomer.email, nif: selectedCustomer.nif, notes: selectedCustomer.notes } : customer,
        issue_date: date, due_date: dueDate, validity_days: type === "QUOTE" ? Number(validity) : null,
        payment_terms: paymentTerms, notes, items, issue_now: issueNow,
      });
    } finally { setCreating(false); }
  }
  return <Modal title="إنشاء مستند جديد" onClose={onClose} wide><form onSubmit={submit}>
    <div className="form-grid document-form-grid">
      <Field label="نوع المستند"><select value={type} onChange={(e) => setType(e.target.value as DocumentType)}>{types.filter((t) => t.value !== "RECEIPT").map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
      <Field label="تاريخ المستند"><input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label={type === "QUOTE" ? "العميل" : "العميل"}>
        <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setCreatingCustomer(false); }}><option value="">عميل جديد / غير مسجل</option>{customers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
      </Field>
      {type === "INVOICE" && <Field label="تاريخ الاستحقاق"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>}
      {type === "QUOTE" && <Field label="مدة صلاحية العرض (يوم)"><input type="number" min="1" value={validity} onChange={(e) => setValidity(e.target.value)} /></Field>}
      {type === "CREDIT_NOTE" && <Field label="الفاتورة المرتبطة"><select required value={relatedInvoiceId} onChange={(e) => setRelatedInvoiceId(e.target.value)}><option value="">اختر فاتورة صادرة</option>{documents.filter((document) => document.type === "INVOICE" && document.status !== "DRAFT" && document.status !== "CANCELLED").map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number} · {safeCustomer(invoice.customer_snapshot).name}</option>)}</select></Field>}
    </div>
    {!customerId && <div className="customer-inline-form"><div className="section-label"><Users size={16} /> بيانات العميل لهذا المستند</div>
      <div className="form-grid">
        <Field label="الاسم / اسم الشركة"><input required value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></Field>
        <Field label="الهاتف"><input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></Field>
        <Field label="العنوان"><input value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} /></Field>
        <Field label="البريد الإلكتروني"><input type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} /></Field>
        <Field label="NIF (اختياري)"><input value={customer.nif} onChange={(e) => setCustomer({ ...customer, nif: e.target.value })} /></Field>
        <div className="quick-add-customer">{creatingCustomer ? <div className="muted-text">أدخل اسم العميل أعلاه ثم احفظه</div> : <button type="button" className="button subtle small" onClick={() => setCreatingCustomer(true)}><CirclePlus size={15} /> حفظ العميل في قاعدة العملاء</button>}</div>
      </div></div>}
    <div className="section-label line-section-title"><ReceiptText size={16} /> تفاصيل المنتجات والخدمات <span>{tax.enabled ? "يمكن تحديد TVA بشكل مستقل لكل بند." : "TVA غير مفعّلة."}</span></div>
    <div className="line-items">
      <div className="line-header"><span>البيان</span><span>الكمية</span><span>سعر الوحدة</span><span>خصم %</span>{tax.enabled && <span>TVA %</span>}<span></span></div>
      {items.map((item, index) => <div className="line-row" key={index}>
        <input required placeholder="وصف المنتج أو الخدمة" value={item.description} onChange={(e) => updateLine(index, { description: e.target.value })} />
        <input aria-label="الكمية" type="number" min="0.001" step="0.001" value={item.quantity} onChange={(e) => updateLine(index, { quantity: Number(e.target.value) })} />
        <input aria-label="سعر الوحدة" type="number" min="0" step="0.01" value={item.unit_price} onChange={(e) => updateLine(index, { unit_price: Number(e.target.value) })} />
        <input aria-label="نسبة الخصم" type="number" min="0" max="100" step="0.01" value={item.discount} onChange={(e) => updateLine(index, { discount: Number(e.target.value) })} />
        {tax.enabled && <input aria-label="نسبة TVA" type="number" min="0" max="100" step="0.01" placeholder={tax.default_rate === null ? "—" : String(tax.default_rate)} value={item.tax_rate ?? ""} onChange={(e) => updateLine(index, { tax_rate: e.target.value === "" ? null : Number(e.target.value) })} />}
        <button type="button" className="icon-button danger-icon" aria-label="حذف البند" disabled={items.length === 1} onClick={() => setItems(items.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
      </div>)}
      <button type="button" className="add-line" onClick={() => setItems([...items, emptyLine()])}><CirclePlus size={15} /> إضافة بند</button>
    </div>
    <div className="document-bottom">
      <div className="document-extra">
        <Field label="شروط الدفع"><input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="مثال: الدفع نقداً" /></Field>
        <Field label={type === "CREDIT_NOTE" ? "سبب الإشعار الدائن (مطلوب)" : "ملاحظات"}><textarea rows={2} required={type === "CREDIT_NOTE"} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <div className="totals-box"><div><span>Total HT</span><b>{money(totals.ht)} دج</b></div>{tax.enabled && <div><span>TVA</span><b>{money(totals.tax)} دج</b></div>}<div className="grand-total"><span>{tax.enabled ? "Total TTC" : "المجموع النهائي"}</span><b>{money(totals.ttc)} دج</b></div></div>
    </div>
    <label className="issue-choice"><input type="checkbox" checked={issueNow} onChange={(e) => setIssueNow(e.target.checked)} /><span><b>إصدار المستند الآن</b><small>إلغاء التحديد يحفظه كمسودة دون تخصيص رقم رسمي.</small></span></label>
    <div className="modal-actions"><button type="button" className="button outline" onClick={onClose}>إلغاء</button><button className="button primary" disabled={creating}><Save size={16} /> {creating ? "جارٍ الحفظ…" : issueNow ? "حفظ وإصدار" : "حفظ كمسودة"}</button></div>
  </form>
  </Modal>;
  function updateLine(index: number, patch: Partial<LineDraft>) {
    setItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  }
}

function calculatePreview(items: LineDraft[], tax: TaxSettings) {
  let ht = 0, taxAmount = 0, ttc = 0;
  for (const item of items) {
    const rate = tax.enabled ? (item.tax_rate ?? tax.default_rate) : null;
    const amount = item.quantity * item.unit_price * (1 - item.discount / 100);
    if (!tax.enabled || rate === null || rate === 0) { ht += amount; ttc += amount; continue; }
    const lineHt = tax.price_mode === "TTC" ? amount / (1 + rate / 100) : amount;
    const lineTtc = tax.price_mode === "TTC" ? amount : lineHt * (1 + rate / 100);
    ht += lineHt; ttc += lineTtc;
    taxAmount += lineTtc - lineHt;
  }
  return { ht, tax: taxAmount, ttc };
}

function CustomerForm({ value, setValue, onSave, onClose }: {
  value: ReturnType<typeof customerBlank>; setValue: (value: ReturnType<typeof customerBlank>) => void;
  onSave: () => void; onClose: () => void;
}) {
  return <Modal title="إضافة / تعديل عميل" onClose={onClose}><div className="form-grid">
    <Field label="الاسم الكامل / اسم الشركة" wide><input required value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} /></Field>
    <Field label="العنوان" wide><input value={value.address} onChange={(e) => setValue({ ...value, address: e.target.value })} /></Field>
    <Field label="الهاتف"><input value={value.phone} onChange={(e) => setValue({ ...value, phone: e.target.value })} /></Field>
    <Field label="البريد الإلكتروني"><input type="email" value={value.email} onChange={(e) => setValue({ ...value, email: e.target.value })} /></Field>
    <Field label="NIF (اختياري)"><input value={value.nif} onChange={(e) => setValue({ ...value, nif: e.target.value })} /></Field>
    <Field label="ملاحظات" wide><textarea rows={3} value={value.notes} onChange={(e) => setValue({ ...value, notes: e.target.value })} /></Field>
  </div><div className="modal-actions"><button className="button outline" onClick={onClose}>إلغاء</button><button className="button primary" onClick={onSave}><Save size={16} /> حفظ العميل</button></div></Modal>;
}

function DocumentDetails({ document, history, relatedDocuments, onOpenRelated, onClose, onPrint, onIssue, onConvert, onDuplicate, onPayment, onCancel, onQuoteStatus }: {
  document: DocumentRecord; history: Array<{ action: string; reason: string; created_at: string }>;
  relatedDocuments: Array<DocumentRecord & { relation_type: string; direction: "INCOMING" | "OUTGOING" }>;
  onOpenRelated: (id: number) => void;
  onClose: () => void; onPrint: (exportPdf: boolean) => void; onIssue: () => void; onConvert: () => void;
  onDuplicate: () => void; onPayment: () => void; onCancel: () => void;
  onQuoteStatus: (status: "ACCEPTED" | "REJECTED") => void;
}) {
  const customer = safeCustomer(document.customer_snapshot);
  const tax = JSON.parse(document.tax_snapshot) as TaxSettings;
  const business = JSON.parse(document.business_snapshot) as BusinessSettings;
  const typeEn: Record<string, string> = { INVOICE: "FACTURE", PROFORMA: "FACTURE PROFORMA", QUOTE: "DEVIS", PURCHASE_ORDER: "BON DE COMMANDE", RECEIPT: "REÇU DE PAIEMENT", CREDIT_NOTE: "AVOIR" };
  return <Modal title={`تفاصيل ${typeLabel(document.type)}`} onClose={onClose} wide>
    <div className="detail-toolbar"><div><span className="document-number-large">{document.number ?? "مسودة"}</span><span className={`status-pill status-${document.status.toLowerCase()}`}>{statusNames[document.status]}</span></div>
      <div className="button-row"><button className="button outline small" onClick={() => onPrint(true)}><Printer size={15} /> PDF</button><button className="button outline small" onClick={() => onPrint(false)}><Printer size={15} /> طباعة</button>
        {document.status === "DRAFT" && <button className="button primary small" onClick={onIssue}><Check size={15} /> إصدار</button>}
        {document.type === "PROFORMA" && document.status === "ISSUED" && <button className="button primary small" onClick={onConvert}><ArrowLeftRight size={15} /> تحويل إلى فاتورة</button>}
        {document.type === "INVOICE" && document.status === "ISSUED" && document.balance > 0.005 && <button className="button outline small" onClick={onPayment}><Banknote size={15} /> تسجيل دفعة</button>}
        {document.type === "QUOTE" && document.status === "ISSUED" && <><button className="button outline small" onClick={() => onQuoteStatus("ACCEPTED")}>قبول العرض</button><button className="button outline small" onClick={() => onQuoteStatus("REJECTED")}>رفض العرض</button></>}
        <button className="button subtle small" onClick={onDuplicate}>نسخ كمسودة</button></div>
    </div>
    <div className="document-preview">
      <div className="preview-head"><div><b>{business.name || "Nom commercial"}</b><div>{business.address}<br />{business.phone} {business.email}</div></div><div className="preview-ids">RC: {business.rc || "—"} · NIF: {business.nif || "—"}<br />NIS: {business.nis || "—"} · AI: {business.ai || "—"}</div></div>
      <h2>{typeEn[document.type]}</h2><b>{document.number ?? "BROUILLON"}</b>
      <div className="preview-parties"><div><b>Client</b><br /><span dir="auto">{customer.name}</span><br /><span dir="auto">{customer.address}</span><br />{customer.phone}</div><div><b>Date:</b> {formatDate(document.issue_date)}<br /><b>Conditions:</b> {document.payment_terms || "—"}<br />{document.validity_days ? `Validité: ${document.validity_days} jours` : ""}</div></div>
      <table className="preview-table"><thead><tr><th>Désignation</th><th>Qté</th><th>Prix unitaire</th><th>Remise</th><th>HT</th>{tax.enabled && <th>TVA</th>}<th>TTC</th></tr></thead><tbody>{document.items?.map((item) => <tr key={item.id}><td dir="auto">{item.description}</td><td>{item.quantity}</td><td>{money(item.unit_price)} DZD</td><td>{item.discount}%</td><td>{money(item.line_ht)} DZD</td>{tax.enabled && <td>{item.tax_rate ?? "—"}% · {money(item.tax_amount)} DZD</td>}<td>{money(item.line_ttc)} DZD</td></tr>)}</tbody></table>
      <div className="preview-totals"><div><span>Total HT</span><b>{money(document.subtotal_ht)} DZD</b></div>{tax.enabled && <div><span>TVA</span><b>{money(document.total_tax)} DZD</b></div>}<div className="grand-total"><span>{tax.enabled ? "Total TTC" : "Total"}</span><b>{money(document.total_ttc)} DZD</b></div>{document.type === "INVOICE" && <div><span>Solde dû</span><b>{money(document.balance)} DZD</b></div>}</div>
      <div className="preview-footer"><span>{business.footer}</span><span>Signature et cachet: {business.signature_path ? "✓" : "—"}</span></div>
    </div>
    {relatedDocuments.length > 0 && <div className="history-panel"><div className="section-label"><ArrowLeftRight size={16} /> المستندات المرتبطة</div>{relatedDocuments.map((related) => <button className="debt-row" key={`${related.id}-${related.relation_type}`} onClick={() => onOpenRelated(related.id)}><span>{related.number ?? "مسودة"} · {typeLabel(related.type)}</span><span>{related.relation_type === "CONVERTED_TO" ? "فاتورة منشأة من هذه الأولية" : related.relation_type === "CREDIT_FOR" ? "إشعار دائن / الفاتورة المرتبطة" : "إيصال الدفع المرتبط"}</span><b>{statusNames[related.status]}</b></button>)}</div>}
    {document.status !== "DRAFT" && document.status !== "CANCELLED" && <button className="text-danger" onClick={onCancel}>Annuler ce document avec motif</button>}
    <div className="history-panel"><div className="section-label"><History size={16} /> سجل التغييرات والترقيم</div>{history.length ? history.map((entry, index) => <div className="history-row" key={index}><span>{entry.action}{entry.reason ? ` · ${entry.reason}` : ""}</span><small>{new Date(entry.created_at).toLocaleString("ar-DZ")}</small></div>) : <div className="empty-inline">لا يوجد سجل بعد.</div>}</div>
  </Modal>;
}

function PaymentDialog({ document, onClose, onSave }: {
  document: DocumentRecord; onClose: () => void; onSave: (value: { invoice_id: number; amount: number; method: string; date: string }) => void;
}) {
  const [amount, setAmount] = useState(String(document.balance));
  const [method, setMethod] = useState("Espèces");
  const [date, setDate] = useState(dateToday());
  return <Modal title="تسجيل دفعة وإنشاء إيصال" onClose={onClose}><div className="payment-context"><span>الفاتورة</span><b>{document.number}</b><span>المبلغ المتبقي</span><b>{money(document.balance)} دج</b></div>
    <div className="form-grid"><Field label="المبلغ المستلم (دج)"><input type="number" min="0.01" max={document.balance} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="تاريخ الدفع"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="طريقة الدفع" wide><select value={method} onChange={(e) => setMethod(e.target.value)}><option>Espèces</option><option>Virement bancaire</option><option>Carte bancaire</option><option>Chèque</option><option>Autre</option></select></Field></div>
    <div className="modal-actions"><button className="button outline" onClick={onClose}>إلغاء</button><button className="button primary" disabled={!Number(amount) || Number(amount) > document.balance} onClick={() => onSave({ invoice_id: document.id, amount: Number(amount), method, date })}><Banknote size={16} /> تسجيل الدفعة</button></div>
  </Modal>;
}

function CancelDialog({ reason, setReason, onClose, onSave }: {
  reason: string; setReason: (value: string) => void; onClose: () => void; onSave: () => void;
}) {
  return <Modal title="إلغاء مستند صادر" onClose={onClose}><div className="warning-note"><ShieldCheck size={19} /><span>سيبقى المستند ورقمه محفوظين في الأرشيف. لا يمكن حذف مستند صادر.</span></div>
    <Field label="سبب الإلغاء"><textarea rows={4} minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="اكتب سبب الإلغاء…" /></Field>
    <div className="modal-actions"><button className="button outline" onClick={onClose}>تراجع</button><button className="button danger" disabled={reason.trim().length < 3} onClick={onSave}><X size={16} /> تأكيد الإلغاء</button></div>
  </Modal>;
}

function BackupPage({ onError, onNotice }: { onError: (message: string) => void; onNotice: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function backup() {
    setBusy(true);
    try { const folder = await window.appApi.createBackup(); if (folder) onNotice(`تم التحقق من النسخة وحفظها في: ${folder}`); }
    catch (reason) { onError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  async function restore() {
    if (!window.confirm("سيتم استبدال بيانات التطبيق الحالية بمحتوى النسخة المختارة. هل أنشأت نسخة احتياطية حديثة للبيانات الحالية؟")) return;
    setBusy(true);
    try { await window.appApi.restoreBackup(); onNotice("تم التحقق من النسخة واستعادة البيانات."); }
    catch (reason) { onError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return <div className="settings-layout">
    <div className="backup-hero"><span className="backup-hero-icon"><ShieldCheck size={27} /></span><div><span className="eyebrow">حماية بياناتك</span><h2>نسخ احتياطي محلي موثوق</h2><p>تُحفظ قاعدة البيانات والمرفقات والصور في مجلد تختاره، مع فحص سلامة قاعدة البيانات قبل اعتماد النسخة أو استعادتها.</p></div></div>
    <div className="backup-options">
      <div className="panel backup-card"><span className="backup-option-icon teal-bg"><Save size={21} /></span><h3>إنشاء نسخة احتياطية</h3><p>نسخ قاعدة SQLite ومجلد الصور والمرفقات إلى مجلد من اختيارك.</p><button className="button primary" disabled={busy} onClick={backup}><Save size={16} /> إنشاء نسخة احتياطية</button></div>
      <div className="panel backup-card"><span className="backup-option-icon amber-bg"><RotateCcw size={21} /></span><h3>استعادة نسخة احتياطية</h3><p>تحقق من سلامة الملفات أولاً ثم استبدل بيانات التطبيق بالنسخة المختارة.</p><button className="button outline" disabled={busy} onClick={restore}><RotateCcw size={16} /> اختيار نسخة للاستعادة</button></div>
    </div>
    <div className="panel data-location"><div><h3>موقع بيانات التطبيق</h3><p>تُخزن البيانات تلقائياً في مجلد بيانات المستخدم الدائم على Windows، وليس في مجلد التثبيت.</p></div><button className="button subtle" onClick={() => window.appApi.openDataFolder()}><FolderOpen size={16} /> فتح مجلد البيانات</button></div>
    <div className="info-note"><ShieldCheck size={17} /><span>احفظ النسخ الاحتياطية على وسيط آمن منفصل. النسخ الاحتياطية لا تُرفع إلى الإنترنت.</span></div>
  </div>;
}

function FilesPage({ files, categories, query, setQuery, categoryFilter, setCategoryFilter, displayName, setDisplayName,
  uploadCategoryId, setUploadCategoryId, newCategoryName, setNewCategoryName, sort, setSort, onUpload, onAddCategory,
  onReorderCategories, onRename, onSetCategory, onDownload, onOpen }: {
  files: ManagedFileRecord[];
  categories: FileCategoryRecord[];
  query: string;
  setQuery: (value: string) => void;
  categoryFilter: string;
  setCategoryFilter: (value: string) => void;
  displayName: string;
  setDisplayName: (value: string) => void;
  uploadCategoryId: string;
  setUploadCategoryId: (value: string) => void;
  newCategoryName: string;
  setNewCategoryName: (value: string) => void;
  sort: "newest" | "name";
  setSort: (value: "newest" | "name") => void;
  onUpload: () => void;
  onAddCategory: () => void;
  onReorderCategories: (ids: number[]) => void;
  onRename: (id: number, name: string) => Promise<boolean>;
  onSetCategory: (id: number, categoryId: number) => void;
  onDownload: (id: number) => void;
  onOpen: (id: number) => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const visibleCategories = categoryFilter
    ? categories.filter((category) => String(category.id) === categoryFilter)
    : categories;
  const groupedFiles = visibleCategories.map((category) => ({
    category,
    files: files.filter((file) => file.category_id === category.id).sort((a, b) =>
      sort === "name" ? a.display_name.localeCompare(b.display_name, "ar") : b.created_at.localeCompare(a.created_at)),
  }));

  return <div className="stack">
    <div className="panel word-upload-panel">
      <div className="word-intro">
        <span className="word-icon"><FileText size={22} /></span>
        <div><h2>حفظ الملفات محلياً</h2><p>ارفع ملفات Word أو PDF أو Excel، صنّفها ورتّبها، ثم نزّل نسخة عند الحاجة.</p></div>
      </div>
      <div className="file-upload-grid">
        <Field label="اسم الملف داخل التطبيق"><input required maxLength={150} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="مثال: طلب شراء شهر نوفمبر" /></Field>
        <Field label="التصنيف"><select value={uploadCategoryId} onChange={(event) => setUploadCategoryId(event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
        <button className="button primary" disabled={!displayName.trim() || !uploadCategoryId} onClick={onUpload}><FileUp size={17} /> اختيار ملف ورفعه</button>
      </div>
      <div className="info-note"><ShieldCheck size={17} /><span>تُحفظ الملفات في مجلد بيانات التطبيق وتُضمّن في النسخ الاحتياطية. الصيغ المدعومة: DOC، DOCX، PDF، XLS، XLSX.</span></div>
    </div>
    <div className="panel category-manager">
      <div className="panel-heading"><div><h3>التصنيفات</h3><p>أضف تصنيفاتك ثم استخدم الأسهم لتحديد ترتيب ظهورها.</p></div></div>
      <div className="category-add-row"><div className="search-box category-name-box"><input value={newCategoryName} maxLength={60} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="اسم تصنيف جديد…" /></div>
        <button className="button outline small" disabled={!newCategoryName.trim()} onClick={onAddCategory}><CirclePlus size={15} /> إضافة تصنيف</button>
      </div>
      <div className="category-order-list">{categories.map((category, index) => <div className="category-order-item" key={category.id}>
        <span className="category-count">{category.file_count}</span><b>{category.name}</b>
        <div className="category-order-actions"><button title="تحريك لأعلى" disabled={index === 0} onClick={() => {
          const ids = categories.map((item) => item.id);
          [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
          onReorderCategories(ids);
        }}><ArrowUp size={14} /></button><button title="تحريك لأسفل" disabled={index === categories.length - 1} onClick={() => {
          const ids = categories.map((item) => item.id);
          [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
          onReorderCategories(ids);
        }}><ArrowDown size={14} /></button></div>
      </div>)}</div>
    </div>
    <div className="panel">
      <div className="panel-heading file-list-heading"><div><h3>أرشيف الملفات</h3><p>{files.length} ملف في النتائج · البيانات محفوظة على هذا الجهاز</p></div>
        <div className="file-list-filters">
          <div className="search-box word-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالاسم…" /></div>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">كل التصنيفات</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
          <select value={sort} onChange={(event) => setSort(event.target.value as "newest" | "name")}><option value="newest">الأحدث أولاً</option><option value="name">ترتيب الاسم</option></select>
        </div>
      </div>
      {files.length === 0 ? <div className="empty-state"><FileText size={25} /><b>لا توجد ملفات مطابقة</b><span>ارفع ملفاً أو غيّر التصنيف المحدد.</span></div> :
        <div className="file-category-groups">{groupedFiles.map(({ category, files: categoryFiles }) => <section className="file-category-group" key={category.id}>
          <div className="file-category-title"><h4>{category.name}</h4><span>{categoryFiles.length} ملف</span></div>
          {categoryFiles.length === 0 ? <div className="empty-category">لا توجد ملفات في هذا التصنيف بعد.</div> :
            <div className="word-file-list">{categoryFiles.map((file) => <div className="word-file-row" key={file.id}
              onDoubleClick={(event) => {
                if (event.target instanceof HTMLElement && event.target.closest("button,select,input")) return;
                onOpen(file.id);
              }}>
              <span className={`word-extension ext-${file.extension.slice(1)}`}>{file.extension.slice(1).toUpperCase()}</span>
              <div className="word-file-details" title="انقر مرتين لفتح الملف">
                {editingId === file.id ? <input className="word-name-input" aria-label="الاسم الجديد" autoFocus maxLength={150} value={editingName} onChange={(event) => setEditingName(event.target.value)} /> :
                  <b>{file.display_name}.{file.extension.slice(1)}</b>}
                <small>{file.original_name} · {formatBytes(file.size_bytes)} · {formatDate(file.created_at)}</small>
              </div>
              <select className="file-row-category" aria-label="تصنيف الملف" value={file.category_id} onChange={(event) => onSetCategory(file.id, Number(event.target.value))}>
                {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <div className="word-file-actions">
                {editingId === file.id ? <>
                  <button className="button primary small" disabled={!editingName.trim()} onClick={async () => {
                    if (await onRename(file.id, editingName)) setEditingId(null);
                  }}><Save size={14} /> حفظ الاسم</button>
                  <button className="button subtle small" onClick={() => setEditingId(null)}>إلغاء</button>
                </> : <button className="button outline small" onClick={() => { setEditingId(file.id); setEditingName(file.display_name); }}>إعادة التسمية</button>}
                <button className="button outline small" title="فتح الملف" onClick={() => onOpen(file.id)}><ExternalLink size={14} /> فتح</button>
                <button className="button outline small" onClick={() => onDownload(file.id)}><Download size={15} /> تنزيل</button>
              </div>
            </div>)}</div>}
        </section>)}</div>}
    </div>
  </div>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} كيلوبايت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ميغابايت`;
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`field ${wide ? "wide" : ""}`}><span>{label}</span>{children}</label>;
}

function Modal({ title, children, onClose, wide = false }: {
  title: string; children: React.ReactNode; onClose: () => void; wide?: boolean;
}) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
    <header className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={18} /></button></header><div className="modal-body">{children}</div>
  </section></div>;
}

function safeCustomer(snapshot: string): { name: string; address: string; phone: string; email: string; nif: string } {
  try { return { name: "", address: "", phone: "", email: "", nif: "", ...JSON.parse(snapshot) }; }
  catch { return { name: "", address: "", phone: "", email: "", nif: "" }; }
}
function typeLabel(type: string) { return types.find((entry) => entry.value === type)?.label ?? type; }
function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR").format(date);
}
