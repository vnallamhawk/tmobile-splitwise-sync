import "dotenv/config";
import fs from "node:fs";
import readline from "node:readline/promises";
import { parseBillPdf } from "./parseBill";
import { computeSplits, CategorySplit } from "./splitCalculator";
import { findLatestBill } from "./gmail";
import { findGroupByName, resolveUserIdsByEmail, createExpense, getExistingExpenseTitles } from "./splitwise";
import { peopleConfig } from "../config/people";

const GROUP_NAME = "T-Mobile";

function printDryRun(splits: CategorySplit[]) {
  console.log("\n=== Dry run: what would be posted to Splitwise ===");
  for (const split of splits) {
    const tag = split.personalOnly ? " (personal only -- NOT posted)" : "";
    console.log(`\n"${split.title}" -- total $${split.total.toFixed(2)}${tag}`);
    for (const share of split.owedShares) {
      console.log(`  ${share.name.padEnd(35)} $${share.amount.toFixed(2)}`);
    }
  }
  console.log("");
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

async function main() {
  const args = process.argv.slice(2);
  const fileFlagIndex = args.indexOf("--file");
  const filePath = fileFlagIndex !== -1 ? args[fileFlagIndex + 1] : undefined;
  const dryRunOnly = args.includes("--dry-run");
  const yes = args.includes("--yes"); // skip the confirmation prompt, for scheduled/unattended runs

  let pdfBuffer: Buffer;
  let sourceLabel: string;

  if (filePath) {
    pdfBuffer = fs.readFileSync(filePath);
    sourceLabel = filePath;
  } else {
    console.log("Searching Gmail for the latest T-Mobile bill...");
    const bill = await findLatestBill();
    if (!bill) {
      console.log("No T-Mobile bill email found (nothing new to do).");
      return;
    }
    pdfBuffer = bill.pdfBuffer;
    sourceLabel = `Gmail message ${bill.messageId} (${bill.filename})`;
  }

  console.log(`Parsing bill from ${sourceLabel}...`);
  const bill = await parseBillPdf(pdfBuffer);
  console.log(`Bill period: ${bill.period.start.toDateString()} - ${bill.period.end.toDateString()} | Total due: $${bill.totalDue.toFixed(2)}`);

  const splits = computeSplits(bill, peopleConfig);
  printDryRun(splits);

  if (dryRunOnly) {
    console.log("--dry-run set, stopping here.");
    return;
  }

  const postable = splits.filter((s) => !s.personalOnly && s.owedShares.length > 0);
  if (postable.length === 0) {
    console.log("Nothing to post -- every category this month is personal-only.");
    return;
  }

  console.log(`Resolving "${GROUP_NAME}" Splitwise group...`);
  const group = await findGroupByName(GROUP_NAME);
  const userIdByEmail = resolveUserIdsByEmail(group);

  // Splitwise itself is the source of truth for "already posted" -- a scheduled/CI run has no
  // persistent local disk between runs, so we check by exact expense title instead of local state.
  // This also naturally handles resuming after a partial run (e.g. daily rate limit hit).
  const existingTitles = await getExistingExpenseTitles(group.id);
  const toPost = postable.filter((s) => !existingTitles.has(s.title));

  if (toPost.length === 0) {
    console.log(`Already fully posted for ${bill.period.label}. Nothing left to do.`);
    return;
  }
  const alreadyPostedCount = postable.length - toPost.length;
  if (alreadyPostedCount > 0) {
    console.log(`${alreadyPostedCount} categor${alreadyPostedCount === 1 ? "y" : "ies"} already posted for ${bill.period.label}. Remaining: ${toPost.map((s) => s.category).join(", ")}.`);
  }

  if (!yes) {
    const proceed = await confirm(`Post ${toPost.length} expense(s) to the "${GROUP_NAME}" Splitwise group?`);
    if (!proceed) {
      console.log("Aborted -- nothing was posted.");
      return;
    }
  }

  const created: { id: number; description: string }[] = [];
  const stillPending: CategorySplit[] = [];
  let stopEarly = false;

  for (const split of toPost) {
    if (stopEarly) {
      stillPending.push(split);
      continue;
    }
    const owedShares = split.owedShares.map((share) => {
      const userId = userIdByEmail.get(share.email.toLowerCase());
      if (!userId) {
        throw new Error(`No Splitwise group member found for ${share.email} (needed for "${split.title}")`);
      }
      return { userId, amount: share.amount };
    });
    const paidByUserId = userIdByEmail.get(split.paidByEmail.toLowerCase());
    if (!paidByUserId) throw new Error(`Payer ${split.paidByEmail} not found in Splitwise group`);

    try {
      const result = await createExpense({
        groupId: group.id,
        description: split.title,
        total: split.total,
        paidByUserId,
        owedShares,
      });
      console.log(`Posted "${result.description}" (expense #${result.id})`);
      created.push(result);
    } catch (err) {
      console.error(`\nFailed to post "${split.title}" -- likely Splitwise's daily rate limit: ${err instanceof Error ? err.message : err}`);
      stopEarly = true;
      stillPending.push(split);
    }
  }

  console.log(`\n${created.length} expense(s) posted this run.`);
  if (stillPending.length > 0) {
    console.log(`Still pending for ${bill.period.label}: ${stillPending.map((s) => s.category).join(", ")}. The next scheduled/manual run will pick these up automatically.`);
    process.exitCode = 1; // signal partial failure so a CI schedule surfaces it (e.g. GitHub's failed-run email)
  } else {
    console.log("All categories for this bill period are now posted.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
