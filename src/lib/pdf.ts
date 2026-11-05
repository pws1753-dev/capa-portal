import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate, formatDateTime } from "./format";

const BRAND_RED: [number, number, number] = [227, 30, 37];
const CHARCOAL: [number, number, number] = [43, 42, 40];
const SLATE: [number, number, number] = [100, 116, 139];

export type PdfSignature = { name?: string; designation?: string; department?: string; at?: string; notes?: string } | null;

export type PdfComplaint = {
  number: string;
  type: "External" | "Internal";
  status: string;
  receivedAt?: string;
  closedAt?: string | null;
  closureRemarks?: string;
  description?: string;
  customer?: string;
  customerContact?: string;
  customerLocation?: string;
  project?: string;
  customerPO?: string;
  product?: string;
  batch?: string;
  category?: string;
  subCategory?: string;
  isRepeat?: boolean;
  company?: { name?: string; code?: string; documentNumber?: string; revision?: string; effectiveDate?: string } | null;
  priority?: { name?: string } | null;
  owner?: { name?: string } | null;
  responsibleDept?: { name?: string } | null;
  internalDept?: { name?: string } | null;
  againstDept?: { name?: string } | null;
  d0?: string;
  d1Team?: { name?: string; dept?: string; designation?: string; role?: string }[];
  d2?: Record<string, string | undefined>;
  d3Actions?: PdfAction[];
  d4QcTools?: string[];
  d4Occurrence?: string;
  d4Escape?: string;
  d4Systemic?: string;
  rootCauseCategory?: string;
  fiveWhy?: { occurrence?: string[]; escape?: string[]; systemic?: string[]; singleChain?: string[] };
  fishbone?: Record<string, string[]>;
  d5Occurrence?: PdfAction[];
  d5Escape?: PdfAction[];
  d5Systemic?: PdfAction[];
  d5Safety?: string;
  d6Verify?: PdfAction[];
  d6DocsList?: { docType?: string; status?: string; revision?: string; revDate?: string; approver?: string; naJustification?: string }[];
  d6Horizontal?: string;
  d7ShortTermDate?: string;
  d7RepeatObserved?: boolean;
  d7LongTermDate?: string;
  d7LongTermResult?: string;
  d7LongTermNotes?: string;
  d8Recognition?: string;
  d8ReviewedBy?: string;
  internalInvestigation?: { summary?: string; findings?: string; correctiveAction?: string; evidence?: string };
  signatures?: { prepared?: PdfSignature; reviewed?: PdfSignature; approved?: PdfSignature };
};

export type PdfAction = { action?: string; resp?: string; target?: string; status?: string };

export type PdfCapa = {
  number: string;
  type?: string;
  action?: string;
  owner?: { name?: string } | null;
  ownerEmployee?: { name?: string } | null;
  department?: { name?: string } | null;
  dueDate?: string;
  completedAt?: string | null;
  status?: string;
  effectiveness?: string | null;
  verificationMethod?: string;
  evidenceReview?: { status?: string; remarks?: string } | null;
};

type Cursor = { y: number };

const MARGIN = 12;

function lastY(doc: jsPDF, fallback: number) {
  const table = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return table ? table.finalY : fallback;
}

function ensureSpace(doc: jsPDF, cursor: Cursor, needed: number) {
  if (cursor.y + needed > doc.internal.pageSize.getHeight() - 18) {
    doc.addPage();
    cursor.y = 26;
  }
}

function sectionTitle(doc: jsPDF, cursor: Cursor, label: string, title: string) {
  ensureSpace(doc, cursor, 14);
  doc.setFillColor(...BRAND_RED);
  doc.rect(MARGIN, cursor.y, 14, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(label, MARGIN + 7, cursor.y + 4.8, { align: "center" });

  doc.setTextColor(...CHARCOAL);
  doc.setFontSize(10.5);
  doc.text(title, MARGIN + 18, cursor.y + 5);
  cursor.y += 10;
}

function paragraph(doc: jsPDF, cursor: Cursor, label: string, value: string | undefined) {
  const text = (value ?? "").trim() || "Not recorded";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE);
  ensureSpace(doc, cursor, 10);
  doc.text(label, MARGIN, cursor.y);
  cursor.y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...CHARCOAL);
  const lines = doc.splitTextToSize(text, doc.internal.pageSize.getWidth() - MARGIN * 2);
  ensureSpace(doc, cursor, lines.length * 4.4 + 4);
  doc.text(lines, MARGIN, cursor.y);
  cursor.y += lines.length * 4.4 + 4;
}

function actionTable(doc: jsPDF, cursor: Cursor, rows: PdfAction[] | undefined, emptyLabel: string) {
  const body = (rows ?? []).map((row, index) => [
    String(index + 1),
    row.action ?? "",
    row.resp ?? "",
    row.target ?? "",
    row.status ?? ""
  ]);
  if (body.length === 0) {
    paragraph(doc, cursor, emptyLabel, "No rows recorded");
    return;
  }
  autoTable(doc, {
    startY: cursor.y,
    head: [["#", "Action", "Responsibility", "Target", "Status"]],
    body,
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 8, cellPadding: 1.8, overflow: "linebreak", textColor: CHARCOAL },
    headStyles: { fillColor: CHARCOAL, textColor: [255, 255, 255], fontSize: 8 },
    columnStyles: { 0: { cellWidth: 8 }, 2: { cellWidth: 30 }, 3: { cellWidth: 22 }, 4: { cellWidth: 22 } }
  });
  cursor.y = lastY(doc, cursor.y) + 5;
}

function whyChain(doc: jsPDF, cursor: Cursor, title: string, entries: string[] | undefined) {
  const filled = (entries ?? []).filter((entry) => entry && entry.trim());
  if (filled.length === 0) return;
  autoTable(doc, {
    startY: cursor.y,
    head: [[title, ""]],
    body: filled.map((entry, index) => [`Why ${index + 1}`, entry]),
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 8, cellPadding: 1.8, overflow: "linebreak", textColor: CHARCOAL },
    headStyles: { fillColor: SLATE, textColor: [255, 255, 255], fontSize: 8 },
    columnStyles: { 0: { cellWidth: 20, fontStyle: "bold" } }
  });
  cursor.y = lastY(doc, cursor.y) + 4;
}

function header(doc: jsPDF, complaint: PdfComplaint) {
  const width = doc.internal.pageSize.getWidth();
  doc.setFillColor(...CHARCOAL);
  doc.rect(0, 0, width, 18, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(complaint.company?.name || "ONEPWS", MARGIN, 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(complaint.type === "External" ? "8D Corrective Action Report" : "Internal Complaint Investigation Report", MARGIN, 13.5);

  doc.setFontSize(7.5);
  const meta = [
    `Document No: ${complaint.company?.documentNumber || "—"}`,
    `Revision: ${complaint.company?.revision || "—"}`,
    `Effective: ${formatDate(complaint.company?.effectiveDate, "—")}`
  ];
  meta.forEach((line, index) => doc.text(line, width - MARGIN, 6 + index * 4, { align: "right" }));
}

function footer(doc: jsPDF, complaint: PdfComplaint) {
  const pages = doc.getNumberOfPages();
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    if (page > 1) header(doc, complaint);
    doc.setDrawColor(226, 232, 240);
    doc.line(MARGIN, height - 12, width - MARGIN, height - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE);
    doc.text(`${complaint.number} — generated ${formatDateTime(new Date())}`, MARGIN, height - 7);
    doc.text(`Page ${page} of ${pages}`, width - MARGIN, height - 7, { align: "right" });
  }
}

function signatureBlock(doc: jsPDF, cursor: Cursor, complaint: PdfComplaint) {
  sectionTitle(doc, cursor, "SIGN", "Digital sign-off");
  const roles: { key: "prepared" | "reviewed" | "approved"; label: string }[] = [
    { key: "prepared", label: "Prepared By" },
    { key: "reviewed", label: "Reviewed By" },
    { key: "approved", label: "Approved By" }
  ];
  autoTable(doc, {
    startY: cursor.y,
    head: [["Role", "Name", "Designation", "Department", "Signed at", "Notes"]],
    body: roles.map(({ key, label }) => {
      const signature = complaint.signatures?.[key];
      return [
        label,
        signature?.name ?? "Not signed",
        signature?.designation ?? "",
        signature?.department ?? "",
        signature?.at ? formatDateTime(signature.at) : "",
        signature?.notes ?? ""
      ];
    }),
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak", textColor: CHARCOAL },
    headStyles: { fillColor: CHARCOAL, textColor: [255, 255, 255], fontSize: 8 },
    columnStyles: { 0: { cellWidth: 24, fontStyle: "bold" } }
  });
  cursor.y = lastY(doc, cursor.y) + 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...SLATE);
  const note = "This report is signed digitally inside the portal. Each entry records the authenticated user, their designation and the exact timestamp.";
  doc.text(doc.splitTextToSize(note, doc.internal.pageSize.getWidth() - MARGIN * 2), MARGIN, cursor.y);
  cursor.y += 8;
}

export function generateComplaintPdf(complaint: PdfComplaint, capas: PdfCapa[]) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const cursor: Cursor = { y: 24 };
  header(doc, complaint);

  autoTable(doc, {
    startY: cursor.y,
    head: [["Complaint summary", ""]],
    body: [
      ["Complaint number", complaint.number],
      ["Type", complaint.type],
      ["Status", complaint.status],
      ["Received", formatDateTime(complaint.receivedAt)],
      ["Priority", complaint.priority?.name ?? "—"],
      ["Company", complaint.company?.name ?? "—"],
      ["Owner", complaint.owner?.name ?? "—"],
      [
        complaint.type === "External" ? "Responsible department" : "Against department",
        (complaint.type === "External" ? complaint.responsibleDept?.name : complaint.againstDept?.name) ?? "—"
      ],
      ...(complaint.type === "External"
        ? [
            ["Customer", complaint.customer ?? "—"],
            ["Customer location", complaint.customerLocation ?? "—"],
            ["Project", complaint.project ?? "—"],
            ["Customer PO", complaint.customerPO ?? "—"]
          ]
        : [["Raising department", complaint.internalDept?.name ?? "—"]]),
      ["Product", complaint.product ?? "—"],
      ["Batch", complaint.batch ?? "—"],
      ["Category", `${complaint.category ?? "—"}${complaint.subCategory ? ` / ${complaint.subCategory}` : ""}`],
      ["Repeat complaint", complaint.isRepeat ? "Yes" : "No"],
      ["Closed", complaint.closedAt ? formatDateTime(complaint.closedAt) : "Not closed"]
    ],
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 8.5, cellPadding: 2, textColor: CHARCOAL },
    headStyles: { fillColor: BRAND_RED, textColor: [255, 255, 255], fontSize: 9 },
    columnStyles: { 0: { cellWidth: 46, fontStyle: "bold" } }
  });
  cursor.y = lastY(doc, cursor.y) + 6;

  paragraph(doc, cursor, "Complaint description", complaint.description);

  if (complaint.type === "External") {
    sectionTitle(doc, cursor, "D0", "Emergency response and immediate action");
    paragraph(doc, cursor, "Immediate containment of risk", complaint.d0);

    sectionTitle(doc, cursor, "D1", "Cross-functional team");
    const team = (complaint.d1Team ?? []).map((member, index) => [
      String(index + 1),
      member.name ?? "",
      member.dept ?? "",
      member.designation ?? "",
      member.role ?? ""
    ]);
    if (team.length > 0) {
      autoTable(doc, {
        startY: cursor.y,
        head: [["#", "Name", "Department", "Designation", "Responsibility"]],
        body: team,
        margin: { left: MARGIN, right: MARGIN },
        styles: { fontSize: 8, cellPadding: 1.8, overflow: "linebreak", textColor: CHARCOAL },
        headStyles: { fillColor: CHARCOAL, textColor: [255, 255, 255], fontSize: 8 },
        columnStyles: { 0: { cellWidth: 8 } }
      });
      cursor.y = lastY(doc, cursor.y) + 5;
    } else {
      paragraph(doc, cursor, "Team members", "No team recorded");
    }

    sectionTitle(doc, cursor, "D2", "Problem description (5W2H)");
    autoTable(doc, {
      startY: cursor.y,
      head: [["Question", "Answer"]],
      body: [
        ["What", complaint.d2?.what ?? ""],
        ["Where", complaint.d2?.where ?? ""],
        ["When", complaint.d2?.when ?? ""],
        ["Who", complaint.d2?.who ?? ""],
        ["Who is involved", complaint.d2?.involved ?? ""],
        ["How many", complaint.d2?.howMany ?? ""],
        ["How", complaint.d2?.how ?? ""]
      ],
      margin: { left: MARGIN, right: MARGIN },
      styles: { fontSize: 8, cellPadding: 1.8, overflow: "linebreak", textColor: CHARCOAL },
      headStyles: { fillColor: CHARCOAL, textColor: [255, 255, 255], fontSize: 8 },
      columnStyles: { 0: { cellWidth: 34, fontStyle: "bold" } }
    });
    cursor.y = lastY(doc, cursor.y) + 5;

    sectionTitle(doc, cursor, "D3", "Interim containment actions");
    actionTable(doc, cursor, complaint.d3Actions, "Containment actions");

    sectionTitle(doc, cursor, "D4", "Root cause analysis");
    paragraph(doc, cursor, "QC tools used", (complaint.d4QcTools ?? []).join(", "));
    paragraph(doc, cursor, "Occurrence root cause", complaint.d4Occurrence);
    paragraph(doc, cursor, "Escape root cause", complaint.d4Escape);
    paragraph(doc, cursor, "Systemic root cause", complaint.d4Systemic);
    paragraph(doc, cursor, "Root cause category", complaint.rootCauseCategory);
    whyChain(doc, cursor, "5-Why: occurrence", complaint.fiveWhy?.occurrence);
    whyChain(doc, cursor, "5-Why: escape", complaint.fiveWhy?.escape);
    whyChain(doc, cursor, "5-Why: systemic", complaint.fiveWhy?.systemic);

    const fishboneRows = Object.entries(complaint.fishbone ?? {})
      .flatMap(([category, entries]) => (entries ?? []).filter(Boolean).map((entry) => [category, entry]))
      .filter((row) => row[1]);
    if (fishboneRows.length > 0) {
      autoTable(doc, {
        startY: cursor.y,
        head: [["Fishbone category", "Potential cause"]],
        body: fishboneRows,
        margin: { left: MARGIN, right: MARGIN },
        styles: { fontSize: 8, cellPadding: 1.8, overflow: "linebreak", textColor: CHARCOAL },
        headStyles: { fillColor: SLATE, textColor: [255, 255, 255], fontSize: 8 },
        columnStyles: { 0: { cellWidth: 34, fontStyle: "bold" } }
      });
      cursor.y = lastY(doc, cursor.y) + 5;
    }

    sectionTitle(doc, cursor, "D5", "Permanent corrective actions");
    actionTable(doc, cursor, complaint.d5Occurrence, "Occurrence corrective actions");
    actionTable(doc, cursor, complaint.d5Escape, "Escape corrective actions");
    actionTable(doc, cursor, complaint.d5Systemic, "Systemic corrective actions");
    paragraph(doc, cursor, "Safety concerns", complaint.d5Safety);

    sectionTitle(doc, cursor, "D6", "Verification and horizontal deployment");
    actionTable(doc, cursor, complaint.d6Verify, "Verification actions");
    const documents = (complaint.d6DocsList ?? []).map((entry) => [
      entry.docType ?? "",
      entry.status ?? "",
      entry.revision ?? "",
      entry.revDate ?? "",
      entry.approver ?? "",
      entry.naJustification ?? ""
    ]);
    if (documents.length > 0) {
      autoTable(doc, {
        startY: cursor.y,
        head: [["Document", "Status", "Revision", "Rev date", "Approver", "NA justification"]],
        body: documents,
        margin: { left: MARGIN, right: MARGIN },
        styles: { fontSize: 7.5, cellPadding: 1.6, overflow: "linebreak", textColor: CHARCOAL },
        headStyles: { fillColor: CHARCOAL, textColor: [255, 255, 255], fontSize: 7.5 }
      });
      cursor.y = lastY(doc, cursor.y) + 5;
    }
    paragraph(doc, cursor, "Horizontal deployment", complaint.d6Horizontal);

    sectionTitle(doc, cursor, "D7", "Prevent recurrence and effectiveness");
    autoTable(doc, {
      startY: cursor.y,
      head: [["Review", "Date", "Repeat observed", "Result"]],
      body: [
        ["Short term", complaint.d7ShortTermDate || "—", complaint.d7RepeatObserved ? "Yes" : "No", complaint.d7RepeatObserved ? "Repeat seen" : "No repeat"],
        ["Long term", complaint.d7LongTermDate || "—", complaint.d7LongTermResult === "Not Sustained" ? "Yes" : "No", complaint.d7LongTermResult || "Pending"]
      ],
      margin: { left: MARGIN, right: MARGIN },
      styles: { fontSize: 8, cellPadding: 1.8, textColor: CHARCOAL },
      headStyles: { fillColor: CHARCOAL, textColor: [255, 255, 255], fontSize: 8 }
    });
    cursor.y = lastY(doc, cursor.y) + 5;
    paragraph(doc, cursor, "Long-term notes", complaint.d7LongTermNotes);

    sectionTitle(doc, cursor, "D8", "Closure and team recognition");
    paragraph(doc, cursor, "Recognition and closing remarks", complaint.d8Recognition);
    paragraph(doc, cursor, "Reviewed by", complaint.d8ReviewedBy);
  } else {
    sectionTitle(doc, cursor, "INV", "Internal investigation");
    paragraph(doc, cursor, "Problem statement", complaint.d2?.what);
    paragraph(doc, cursor, "Investigation summary", complaint.internalInvestigation?.summary);
    whyChain(doc, cursor, "5-Why", complaint.fiveWhy?.singleChain);
    paragraph(doc, cursor, "Root cause", complaint.d4Occurrence);
    paragraph(doc, cursor, "Root cause category", complaint.rootCauseCategory);
    paragraph(doc, cursor, "Corrective action", complaint.internalInvestigation?.correctiveAction);
    paragraph(doc, cursor, "Evidence", complaint.internalInvestigation?.evidence);
  }

  sectionTitle(doc, cursor, "CAPA", "Corrective and preventive actions");
  if (capas.length === 0) {
    paragraph(doc, cursor, "CAPA items", "No CAPA recorded");
  } else {
    autoTable(doc, {
      startY: cursor.y,
      head: [["CAPA no", "Type", "Action", "Owner", "Due", "Status", "Evidence review", "Effectiveness"]],
      body: capas.map((capa) => [
        capa.number,
        capa.type ?? "",
        capa.action ?? "",
        capa.ownerEmployee?.name ?? capa.owner?.name ?? "",
        formatDate(capa.dueDate, "—"),
        capa.status ?? "",
        capa.evidenceReview?.status ?? "Pending",
        capa.effectiveness ?? "Pending"
      ]),
      margin: { left: MARGIN, right: MARGIN },
      styles: { fontSize: 7.5, cellPadding: 1.6, overflow: "linebreak", textColor: CHARCOAL },
      headStyles: { fillColor: BRAND_RED, textColor: [255, 255, 255], fontSize: 7.5 },
      columnStyles: { 2: { cellWidth: 46 } }
    });
    cursor.y = lastY(doc, cursor.y) + 5;
  }

  if (complaint.closedAt) {
    paragraph(doc, cursor, "Closure remarks", complaint.closureRemarks);
  }

  signatureBlock(doc, cursor, complaint);
  footer(doc, complaint);
  doc.save(`${complaint.number}-${complaint.type === "External" ? "8D" : "Internal"}-report.pdf`);
}
