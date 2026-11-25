import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { BusinessSettings, DocumentRecord, TaxSettings } from "../shared/types";

export interface WordDocumentImage {
  data: Buffer;
  width: number;
  height: number;
}

export interface WordDocumentImages {
  logo?: WordDocumentImage;
  signature?: WordDocumentImage;
}

const teal = "166F68";
const borderColor = "DCE4E8";
const frenchTitles: Record<DocumentRecord["type"], string> = {
  INVOICE: "FACTURE",
  PROFORMA: "FACTURE PROFORMA",
  QUOTE: "DEVIS",
  PURCHASE_ORDER: "BON DE COMMANDE",
  RECEIPT: "REÇU DE PAIEMENT",
  CREDIT_NOTE: "AVOIR",
};

function money(value: number): string {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string): string {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR").format(date);
}

function paragraph(
  text: string,
  options: { bold?: boolean; color?: string; size?: number; rtl?: boolean; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {},
): Paragraph {
  const rtl = options.rtl ?? /[\u0590-\u08FF]/.test(text);
  return new Paragraph({
    alignment: options.alignment ?? (rtl ? AlignmentType.RIGHT : AlignmentType.LEFT),
    bidirectional: rtl,
    spacing: { after: 100 },
    children: [new TextRun({
      text: text || " ",
      font: "Arial",
      size: options.size ?? 20,
      bold: options.bold,
      color: options.color,
      rightToLeft: rtl,
    })],
  });
}

function cell(
  text: string,
  options: { width: number; header?: boolean; rtl?: boolean; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType] },
): TableCell {
  return new TableCell({
    width: { size: options.width, type: WidthType.DXA },
    margins: { top: 90, bottom: 90, left: 100, right: 100 },
    shading: options.header ? { type: ShadingType.CLEAR, fill: teal } : undefined,
    children: [paragraph(text, {
      bold: options.header,
      color: options.header ? "FFFFFF" : undefined,
      size: options.header ? 18 : 18,
      rtl: options.rtl,
      alignment: options.alignment,
    })],
  });
}

function table(rows: TableRow[], columnWidths: number[]): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: borderColor };
  return new Table({
    rows,
    width: { size: columnWidths.reduce((sum, width) => sum + width, 0), type: WidthType.DXA },
    columnWidths,
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
  });
}

export async function createWordDocument(
  document: DocumentRecord,
  images: WordDocumentImages = {},
): Promise<Buffer> {
  const business = JSON.parse(document.business_snapshot) as BusinessSettings;
  const customer = JSON.parse(document.customer_snapshot) as {
    name?: string; address?: string; phone?: string; email?: string; nif?: string;
  };
  const tax = JSON.parse(document.tax_snapshot) as TaxSettings;
  const children: Array<Paragraph | Table> = [];

  const logo = images.logo
    ? new ImageRun({ data: images.logo.data, type: "png", transformation: { width: images.logo.width, height: images.logo.height } })
    : null;
  const businessDetails = [
    business.name,
    business.address,
    [business.phone, business.email, business.website].filter(Boolean).join(" · "),
    [business.rc && `RC: ${business.rc}`, business.nif && `NIF: ${business.nif}`,
      business.nis && `NIS: ${business.nis}`, business.ai && `AI: ${business.ai}`].filter(Boolean).join(" · "),
  ].filter(Boolean);
  children.push(table([
    new TableRow({ children: [
      new TableCell({
        width: { size: 1500, type: WidthType.DXA },
        verticalAlign: "center",
        children: [new Paragraph({ children: logo ? [logo] : [new TextRun(" ")] })],
      }),
      new TableCell({
        width: { size: 8500, type: WidthType.DXA },
        children: businessDetails.map((line, index) => paragraph(line, {
          bold: index === 0,
          color: index === 0 ? teal : undefined,
          size: index === 0 ? 26 : 18,
        })),
      }),
    ] }),
  ], [1500, 8500]));

  children.push(paragraph(frenchTitles[document.type], { bold: true, color: teal, size: 32 }));
  children.push(paragraph(document.number ?? "BROUILLON", { bold: true, size: 24 }));

  const customerInfo = [
    customer.name ?? "",
    customer.address ?? "",
    customer.phone ?? "",
    customer.email ?? "",
    customer.nif ? `NIF: ${customer.nif}` : "",
  ].filter(Boolean);
  const documentInfo = [
    `Date: ${formatDate(document.issue_date)}`,
    document.due_date ? `Échéance: ${formatDate(document.due_date)}` : "",
    document.validity_days ? `Validité: ${document.validity_days} jours` : "",
    document.payment_terms ? `Conditions de paiement: ${document.payment_terms}` : "",
  ].filter(Boolean);
  children.push(table([
    new TableRow({ children: [
      new TableCell({
        width: { size: 5000, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: "F4F7F8" },
        children: [paragraph("Client", { bold: true, color: teal }), ...customerInfo.map((line) => paragraph(line))],
      }),
      new TableCell({
        width: { size: 5000, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: "F4F7F8" },
        children: documentInfo.map((line) => paragraph(line)),
      }),
    ] }),
  ], [5000, 5000]));
  children.push(paragraph(" "));

  const headers = ["Désignation", "Qté", "Prix unitaire", "Remise", "HT"];
  const itemWidths = tax.enabled ? [3000, 700, 1400, 900, 1300, 1400, 1300] : [3700, 800, 1500, 1000, 1500, 1500];
  if (tax.enabled) headers.push("TVA");
  headers.push("TTC");
  const itemRows = [
    new TableRow({ tableHeader: true, children: headers.map((header, index) => cell(header, {
      width: itemWidths[index], header: true,
      alignment: index === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT,
    })) }),
    ...(document.items ?? []).map((item) => {
      const values = [
        item.description,
        String(item.quantity),
        `${money(item.unit_price)} DZD`,
        `${money(item.discount)} %`,
        `${money(item.line_ht)} DZD`,
      ];
      if (tax.enabled) values.push(`${item.tax_rate ?? "—"} % · ${money(item.tax_amount)} DZD`);
      values.push(`${money(item.line_ttc)} DZD`);
      return new TableRow({ cantSplit: true, children: values.map((value, index) => cell(value, {
        width: itemWidths[index],
        rtl: index === 0 ? undefined : false,
        alignment: index === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT,
      })) });
    }),
  ];
  children.push(table(itemRows, itemWidths));
  children.push(paragraph(" "));

  const totals: Array<[string, string]> = [[`Total HT`, `${money(document.subtotal_ht)} DZD`]];
  if (tax.enabled) totals.push(["TVA", `${money(document.total_tax)} DZD`]);
  totals.push([tax.enabled ? "Total TTC" : "Total", `${money(document.total_ttc)} DZD`]);
  if (document.type === "INVOICE") {
    totals.push(["Payé", `${money(document.paid_amount)} DZD`]);
    totals.push(["Reste à payer", `${money(document.balance)} DZD`]);
  }
  children.push(table(totals.map(([label, amount], index) => new TableRow({
    children: [
      cell(label, { width: 6500, header: index === totals.length - 1 }),
      cell(amount, { width: 3500, header: index === totals.length - 1, alignment: AlignmentType.RIGHT }),
    ],
  })), [6500, 3500]));

  if (document.notes) children.push(paragraph(document.notes));
  if (document.status === "CANCELLED" && document.cancel_reason) {
    children.push(paragraph(`Document annulé: ${document.cancel_reason}`, { bold: true, color: "B94A48" }));
  }
  if (business.footer) children.push(paragraph(business.footer));
  if (business.bank_info) children.push(paragraph(business.bank_info));
  if (images.signature) {
    children.push(paragraph("Signature et cachet", { bold: true, color: teal }));
    children.push(new Paragraph({ children: [
      new ImageRun({
        data: images.signature.data,
        type: "png",
        transformation: { width: images.signature.width, height: images.signature.height },
      }),
    ] }));
  }

  const output = new Document({
    creator: business.name || "Cyber Café - Gestion",
    title: `${frenchTitles[document.type]} ${document.number ?? ""}`.trim(),
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 720, right: 850, bottom: 720, left: 850 },
        },
      },
      children,
    }],
  });
  return Packer.toBuffer(output);
}
