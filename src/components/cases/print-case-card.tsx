"use client";

import { Printer, Tag } from "lucide-react";
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

  function openAndPrint(html: string) {
    const printWindow = window.open("", "_blank", "width=800,height=600");
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    const doPrint = () => {
      printWindow.focus();
      printWindow.print();
    };
    printWindow.onload = () => setTimeout(doPrint, 200);
    setTimeout(doPrint, 600);
  }

  function handlePrintFull() {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Expediente ${escapeHtml(caseCode)}</title>
  <style>
    @page {
      size: 5.5in 4.25in;
      margin: 0;
    }
    @media print {
      html, body {
        width: 5.5in;
        min-height: 4.25in;
        margin: 0;
        padding: 0;
      }
    }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      width: 5.5in;
      min-height: 4.25in;
      max-height: 4.25in;
      box-sizing: border-box;
      padding: 0.25in 0.3in;
      border: 2px solid #1B2A4A;
      border-top: 8px solid ${color};
      color: #1B2A4A;
      display: flex;
      flex-direction: column;
    }
    .header {
      text-align: center;
      border-bottom: 1px solid #E5E7EB;
      padding-bottom: 4px;
      margin-bottom: 6px;
      flex-shrink: 0;
    }
    .header h1 {
      font-size: 9pt;
      margin: 0 0 1px 0;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #1B2A4A;
    }
    .header h2 {
      font-size: 7pt;
      margin: 0;
      font-weight: normal;
      letter-spacing: 1px;
      color: #C5A55A;
    }
    .main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 0;
    }
    .exp-number {
      text-align: center;
      font-size: 22pt;
      font-weight: bold;
      color: #1B2A4A;
      margin: 4px 0 2px 0;
      font-family: 'Courier New', monospace;
      line-height: 1;
    }
    .exp-description {
      text-align: center;
      font-size: 9pt;
      font-style: italic;
      color: #374151;
      margin: 2px 0 4px 0;
      padding: 0 4px;
      line-height: 1.2;
      max-height: 2.6em;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .exp-client {
      text-align: center;
      font-size: 11pt;
      font-weight: bold;
      color: #1B2A4A;
      margin: 2px 0 8px 0;
      padding: 0 4px;
      line-height: 1.2;
      max-height: 2.4em;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .rows {
      border-top: 1px solid #E5E7EB;
      padding-top: 5px;
      flex-shrink: 0;
    }
    .row {
      display: flex;
      margin-bottom: 3px;
      font-size: 8pt;
      line-height: 1.25;
    }
    .label {
      color: #6B7280;
      width: 90px;
      flex-shrink: 0;
      font-size: 7pt;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      padding-top: 1px;
    }
    .value {
      color: #1B2A4A;
      font-weight: bold;
      flex: 1;
      min-width: 0;
      word-wrap: break-word;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .classification-badge {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 3px;
      font-size: 7pt;
      font-weight: bold;
      color: ${badgeTextColor};
      background: ${color};
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Despacho Jur&iacute;dico &mdash; Integra Legal</h1>
    <h2>Panam&aacute;</h2>
  </div>

  <div class="main-content">
    <div class="exp-number">${escapeHtml(caseCode)}</div>
    ${description ? `<div class="exp-description">${escapeHtml(description)}</div>` : ""}
    <div class="exp-client">${escapeHtml(clientName)}</div>
  </div>

  <div class="rows">
    <div class="row">
      <span class="label">C&oacute;d. Cliente:</span>
      <span class="value">${escapeHtml(clientNumber)}</span>
    </div>
    <div class="row">
      <span class="label">Clasificaci&oacute;n:</span>
      <span class="value">
        ${classification ? `<span class="classification-badge">${escapeHtml(classification)}</span>` : "&mdash;"}
      </span>
    </div>
    <div class="row">
      <span class="label">Responsable:</span>
      <span class="value">${escapeHtml(responsibleName ?? "\u2014")}</span>
    </div>
    <div class="row">
      <span class="label">Apertura:</span>
      <span class="value">${escapeHtml(formatDate(openedAt))}</span>
    </div>
  </div>
</body>
</html>`;
    openAndPrint(html);
  }

  function handlePrintSimple() {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Etiqueta ${escapeHtml(caseCode)}</title>
  <style>
    @page {
      size: 4in 2in;
      margin: 0;
    }
    @media print {
      html, body {
        width: 4in;
        height: 2in;
        margin: 0;
        padding: 0;
      }
    }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      width: 4in;
      height: 2in;
      box-sizing: border-box;
      padding: 0.15in 0.2in;
      border: 2px solid #1B2A4A;
      border-top: 8px solid ${color};
      color: #1B2A4A;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .exp-number {
      font-size: 26pt;
      font-weight: bold;
      font-family: 'Courier New', monospace;
      line-height: 1;
      margin: 0 0 4px 0;
    }
    .exp-client {
      font-size: 10pt;
      font-weight: bold;
      line-height: 1.2;
      margin: 0;
      padding: 0 4px;
      max-height: 2.4em;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
  </style>
</head>
<body>
  <div class="exp-number">${escapeHtml(caseCode)}</div>
  <div class="exp-client">${escapeHtml(clientName)}</div>
</body>
</html>`;
    openAndPrint(html);
  }

  return (
    <>
      <Button
        onClick={handlePrintFull}
        variant="outline"
        className="min-h-[48px] px-4 gap-2"
      >
        <Printer size={16} />
        Imprimir Tarjeta
      </Button>
      <Button
        onClick={handlePrintSimple}
        variant="outline"
        className="min-h-[48px] px-4 gap-2"
      >
        <Tag size={16} />
        Etiqueta Simple
      </Button>
    </>
  );
}
