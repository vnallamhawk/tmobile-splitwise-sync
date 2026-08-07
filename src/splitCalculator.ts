import { BillData } from "./parseBill";
import { PeopleConfig, resolveBearer } from "../config/people";

export type Category = "plans" | "equipment" | "services" | "oneTime";

export const CATEGORIES: { key: Category; splitwiseSuffix: string }[] = [
  { key: "plans", splitwiseSuffix: "plans" },
  { key: "equipment", splitwiseSuffix: "equipment" },
  { key: "services", splitwiseSuffix: "intl" },
  { key: "oneTime", splitwiseSuffix: "one time charges" },
];

export interface OwedShare {
  email: string;
  name: string;
  /** Dollars, rounded to the cent. */
  amount: number;
}

export interface CategorySplit {
  category: Category;
  /** e.g. "Jun 9 - jul 8 plans" */
  title: string;
  /** Dollars, from the bill's own Totals row. */
  total: number;
  paidByEmail: string;
  /** Includes the payer's own retained share; sums exactly to `total` in cents. */
  owedShares: OwedShare[];
  /** True when the whole category is the payer's own cost -- nothing to post to Splitwise. */
  personalOnly: boolean;
}

function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Divides totalCents into n integer shares that sum exactly to totalCents (largest-remainder method). */
function splitCentsEvenly(totalCents: number, n: number): number[] {
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function computeSplits(bill: BillData, config: PeopleConfig): CategorySplit[] {
  const payer = resolveBearer(config, config.rakeshPhone);
  const accountLine = bill.lines.find((l) => l.lineType === "Account");
  const voiceLines = bill.lines.filter((l) => l.lineType === "Voice");
  const wearableLines = bill.lines.filter((l) => l.lineType === "Wearable");

  return CATEGORIES.map(({ key, splitwiseSuffix }) => {
    const contributionsCents = new Map<string, number>(); // email -> cents
    const names = new Map<string, string>();

    const addContribution = (email: string, name: string, cents: number) => {
      if (cents === 0) return;
      contributionsCents.set(email, (contributionsCents.get(email) ?? 0) + cents);
      names.set(email, name);
    };

    // 1: itemized per-line amounts (voice + wearable), folded through family/wearable rules.
    for (const line of [...voiceLines, ...wearableLines]) {
      const value = line[key];
      if (typeof value !== "number" || value === 0) continue;
      const bearer = line.lineType === "Wearable" ? payer : resolveBearer(config, line.phone);
      addContribution(bearer.splitwiseEmail!, bearer.name, toCents(value));
    }

    // 2: Account-level base charge, split evenly across lines marked "included" for this category.
    const accountValue = accountLine?.[key];
    if (typeof accountValue === "number" && accountValue > 0) {
      const includedLines = voiceLines.filter((l) => l[key] === "included");
      if (includedLines.length > 0) {
        const shares = splitCentsEvenly(toCents(accountValue), includedLines.length);
        includedLines.forEach((line, i) => {
          const bearer = resolveBearer(config, line.phone);
          addContribution(bearer.splitwiseEmail!, bearer.name, shares[i]);
        });
      }
    }

    const totalCents = Array.from(contributionsCents.values()).reduce((a, b) => a + b, 0);
    const billTotalCents = toCents(bill.totals[key]);
    if (totalCents !== billTotalCents) {
      throw new Error(
        `${key} split (${totalCents}c) doesn't match bill total (${billTotalCents}c) -- parsing or split logic is off`
      );
    }

    const owedShares: OwedShare[] = Array.from(contributionsCents.entries()).map(([email, cents]) => ({
      email,
      name: names.get(email)!,
      amount: cents / 100,
    }));

    const nonPayerOwed = owedShares.filter((s) => s.email !== payer.splitwiseEmail);
    const personalOnly = nonPayerOwed.length === 0;

    return {
      category: key,
      title: `${bill.period.label} ${splitwiseSuffix}`,
      total: totalCents / 100,
      paidByEmail: payer.splitwiseEmail!,
      owedShares,
      personalOnly,
    };
  });
}
