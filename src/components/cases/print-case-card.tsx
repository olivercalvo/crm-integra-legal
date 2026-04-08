"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils/format-date";
import { getClassificationColor, getClassificationTextColor } from "@/lib/utils/classification-colors";

interface PrintCaseCardProps {
  caseCode: string;
  clientName: string;
  description: string | null;
  classification: string | null;
  classificationColor: string | null;
  responsibleName: string | null;
  openedAt: string;
  clientNumber: string;
}

export function PrintCaseCard({
  caseCode,
  clientName,
  description,
  classification,
  classificationColor,
  responsibleName,
  openedAt,
  clientNumber,
}: PrintCaseCardProps) {
  const color = classification
    ? getClassificationColor(classification, classificationColor)
    : "#1B2A4A";
  const badgeTextColor = classification
    ? getClassificationTextColor(classification, color)
    : "#FFFFFF";

  function handlePrint() {
    const printWindow = window.open("", "_blank", "width=600,height=400");
    if (!printWindow) return;

    printWindow.document.write(`
<!DOCTYPE html>
<html>
<head>
  <title>Expediente ${caseCode}</title>
  <style>
    @page { size: 5.5in 4.25in; margin: 0.3in; }
    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      margin: 0;
      padding: 0.4in;
      box-sizing: border-box;
      width: 5.5in;
      height: 4.25in;
      border: 2px solid #1B2A4A;
      border-top: 6px solid ${color};
      position: relative;
    }
    .header {
      text-align: center;
      border-bottom: 1px solid #ccc;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .header h1 {
      font-size: 11pt;
      color: #1B2A4A;
      margin: 0 0 2px 0;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .header h2 {
      font-size: 8pt;
      color: #C5A55A;
      margin: 0;
      font-weight: normal;
      letter-spacing: 1px;
    }
    .row {
      display: flex;
      margin-bottom: 6px;
      font-size: 9pt;
    }
    .label {
      color: #666;
      width: 130px;
      flex-shrink: 0;
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .value {
      color: #1B2A4A;
      font-weight: bold;
      flex: 1;
    }
    .exp-number {
      text-align: center;
      font-size: 18pt;
      font-weight: bold;
      color: #1B2A4A;
      margin: 10px 0;
      font-family: 'Courier New', monospace;
    }
    .classification-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 4px;
      font-size: 8pt;
      font-weight: bold;
      color: ${badgeTextColor};
      background: ${color};
    }
    .footer {
      position: absolute;
      bottom: 0.3in;
      left: 0.4in;
      right: 0.4in;
      text-align: center;
      font-size: 7pt;
      color: #999;
      border-top: 1px solid #eee;
      padding-top: 6px;
      letter-spacing: 1px;
    }
    @media print {
      body { border: 2px solid #1B2A4A; border-top: 6px solid ${color}; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Despacho Jurídico &mdash; Integra Legal</h1>
    <h2>Panamá</h2>
  </div>

  <div class="exp-number">${caseCode}</div>

  <div class="row">
    <span class="label">Cliente:</span>
    <span class="value">${clientName}</span>
  </div>
  <div class="row">
    <span class="label">Cód. Cliente:</span>
    <span class="value">${clientNumber}</span>
  </div>
  <div class="row">
    <span class="label">Descripción:</span>
    <span class="value">${description || "—"}</span>
  </div>
  <div class="row">
    <span class="label">Clasificación:</span>
    <span class="value">
      ${classification ? `<span class="classification-badge">${classification}</span>` : "—"}
    </span>
  </div>
  <div class="row">
    <span class="label">Responsable:</span>
    <span class="value">${responsibleName || "—"}</span>
  </div>
  <div class="row">
    <span class="label">Fecha Apertura:</span>
    <span class="value">${formatDate(openedAt)}</span>
  </div>

  <div class="footer">
    INTEGRA LEGAL &bull; Expediente Físico &bull; Uso Interno
  </div>
</body>
</html>
    `);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
    }, 250);
  }

  return (
    <Button
      onClick={handlePrint}
      variant="outline"
      className="min-h-[48px] px-4 gap-2"
    >
      <Printer size={16} />
      Imprimir Tarjeta
    </Button>
  );
}
