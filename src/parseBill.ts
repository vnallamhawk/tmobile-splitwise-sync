import pdfParse from "pdf-parse";

export type CategoryValue = number | "included" | null;

export interface BillLine {
  phone: string; // "Account" for the base account row, or "(312) 478-2243"
  lineType: "Account" | "Voice" | "Wearable";
  plans: CategoryValue;
  equipment: CategoryValue;
  services: CategoryValue;
  oneTime: CategoryValue;
  total: number;
}

export interface BillPeriod {
  start: Date;
  end: Date;
  /** Matches Rakesh's existing Splitwise naming, e.g. "Jun 9 - jul 8" */
  label: string;
}

export interface CategoryTotals {
  plans: number;
  equipment: number;
  services: number;
  oneTime: number;
  total: number;
}

export interface BillData {
  period: BillPeriod;
  totalDue: number;
  totals: CategoryTotals;
  lines: BillLine[];
}

// T-Mobile's PDF uses a non-breaking space ( ) between "(312)" and "478-2243";
// \s in a JS regex already matches  , so PHONE below is safe against either.
const PHONE = String.raw`\(\d{3}\)\s\d{3}-\d{4}`;
const MONEY = String.raw`(?:Included|-|\$[\d,]+\.\d{2})`;
const ROW_RE = new RegExp(
  String.raw`^(${PHONE})(Voice|Wearable)(${MONEY})(${MONEY})(${MONEY})(${MONEY})\$([\d,]+\.\d{2})$`
);
const ACCOUNT_ROW_RE = new RegExp(
  String.raw`^Account(${MONEY})(${MONEY})(${MONEY})(${MONEY})\$([\d,]+\.\d{2})$`
);
const TOTALS_ROW_RE = /^Totals\$([\d,]+\.\d{2})\$([\d,]+\.\d{2})\$([\d,]+\.\d{2})\$([\d,]+\.\d{2})\$([\d,]+\.\d{2})$/;
const PERIOD_RE = /Bill period\s*\n([A-Za-z]{3} \d{2}, \d{4}) - ([A-Za-z]{3} \d{2}, \d{4})/;
const TOTAL_DUE_RE = /TOTAL DUE\s*\n\$\s*\n?(\d+)\s*\n?\.(\d{2})/;

function parseCategoryValue(raw: string): CategoryValue {
  if (raw === "Included") return "included";
  if (raw === "-") return null;
  return Number(raw.replace(/[$,]/g, ""));
}

function formatPeriodLabel(start: Date, end: Date): string {
  const fmt = (d: Date, lower: boolean) => {
    const month = d.toLocaleString("en-US", { month: "short" });
    const s = `${month} ${d.getDate()}`;
    return lower ? s.toLowerCase() : s;
  };
  return `${fmt(start, false)} - ${fmt(end, true)}`;
}

/** Normalize non-breaking spaces ( ) to plain ASCII spaces so downstream string ops (startsWith, etc.) behave predictably. */
function normalizeWhitespace(text: string): string {
  return text.replace(/ /g, " ");
}

export async function parseBillPdf(buffer: Buffer): Promise<BillData> {
  const { text: rawText } = await pdfParse(buffer);
  const text = normalizeWhitespace(rawText);

  const periodMatch = text.match(PERIOD_RE);
  if (!periodMatch) throw new Error("Could not find bill period in PDF text");
  const start = new Date(periodMatch[1]);
  const end = new Date(periodMatch[2]);

  const totalDueMatch = text.match(TOTAL_DUE_RE);
  if (!totalDueMatch) throw new Error("Could not find TOTAL DUE in PDF text");
  const totalDue = Number(`${totalDueMatch[1]}.${totalDueMatch[2]}`);

  const summaryStart = text.indexOf("THIS BILL SUMMARY");
  const summaryEnd = text.indexOf("DETAILED CHARGES");
  if (summaryStart === -1 || summaryEnd === -1) {
    throw new Error("Could not locate THIS BILL SUMMARY section in PDF text");
  }
  const summarySection = text.slice(summaryStart, summaryEnd);

  const lines: BillLine[] = [];
  let totals: CategoryTotals | undefined;
  for (const rawLine of summarySection.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (rawLine.startsWith("Line Type")) continue;

    const totalsMatch = rawLine.match(TOTALS_ROW_RE);
    if (totalsMatch) {
      const [, plans, equipment, services, oneTime, total] = totalsMatch;
      totals = {
        plans: Number(plans.replace(/,/g, "")),
        equipment: Number(equipment.replace(/,/g, "")),
        services: Number(services.replace(/,/g, "")),
        oneTime: Number(oneTime.replace(/,/g, "")),
        total: Number(total.replace(/,/g, "")),
      };
      continue;
    }

    const accountMatch = rawLine.match(ACCOUNT_ROW_RE);
    if (accountMatch) {
      const [, plans, equipment, services, oneTime, total] = accountMatch;
      lines.push({
        phone: "Account",
        lineType: "Account",
        plans: parseCategoryValue(plans),
        equipment: parseCategoryValue(equipment),
        services: parseCategoryValue(services),
        oneTime: parseCategoryValue(oneTime),
        total: Number(total.replace(/,/g, "")),
      });
      continue;
    }

    const rowMatch = rawLine.match(ROW_RE);
    if (rowMatch) {
      const [, phone, lineType, plans, equipment, services, oneTime, total] = rowMatch;
      lines.push({
        phone,
        lineType: lineType as "Voice" | "Wearable",
        plans: parseCategoryValue(plans),
        equipment: parseCategoryValue(equipment),
        services: parseCategoryValue(services),
        oneTime: parseCategoryValue(oneTime),
        total: Number(total.replace(/,/g, "")),
      });
    }
  }

  if (lines.length === 0) {
    throw new Error("Parsed zero bill summary rows -- bill layout may have changed");
  }
  if (!totals) {
    throw new Error("Could not find Totals row in THIS BILL SUMMARY section");
  }

  return {
    period: { start, end, label: formatPeriodLabel(start, end) },
    totalDue,
    totals,
    lines,
  };
}
