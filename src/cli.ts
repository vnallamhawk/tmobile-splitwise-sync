import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { parseBillPdf } from "./parseBill";
import { computeSplits, CategorySplit } from "./splitCalculator";
import { findLatestBill } from "./gmail";
import { findGroupByName, resolveUserIdsByEmail, createExpense } from "./splitwise";
import { peopleConfig } from "../config/people";

const STATE_PATH = path.resolve(".state.json");
const GROUP_NAME = "T-Mobile";

interface State {
  // periodKey -> categories already successfully posted to Splitwise for that bill period.
  // Splitwise's per-day expense-creation cap means a single run might not post everything;
  // tracking per-category (not just per-period) lets a later run pick up exactly what's left
  // without re-posting anything or needing to know the exact daily limit up front.
  periods: Record<string, { postedCategories: string[] }>;
}

function loadState(): State {
  if (!fs.existsSync(STATE_PATH)) return { periods: {} };
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

function saveState(state: State) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

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

  let pdfBuffer: Buffer;
  let sourceLabel: string;
  let gmailMessageId: string | undefined;

  if (filePath) {
    pdfBuffer = fs.readFileSync(filePath);
    sourceLabel = filePath;
  } else {
    console.log("Searching Gmail for the latest T-Mobile bill...");
    const bill = await findLatestBill();
    if (!bill) {
      console.error("No T-Mobile bill email found. Adjust the search query in src/gmail.ts if needed.");
      process.exit(1);
    }
    pdfBuffer = bill.pdfBuffer;
    sourceLabel = `Gmail message ${bill.messageId} (${bill.filename})`;
    gmailMessageId = bill.messageId;
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

  const state = loadState();
  const periodKey = `${bill.period.start.toISOString()}_${bill.period.end.toISOString()}`;
  const alreadyPosted = state.periods[periodKey]?.postedCategories ?? [];

  const postable = splits.filter((s) => !s.personalOnly && s.owedShares.length > 0);
  const toPost = postable.filter((s) => !alreadyPosted.includes(s.category));

  if (postable.length > 0 && toPost.length === 0) {
    console.log(`Already fully posted for ${bill.period.label} (${alreadyPosted.join(", ")}). Nothing left to do.`);
    return;
  }
  if (postable.length === 0) {
    console.log("Nothing to post -- every category this month is personal-only.");
    return;
  }
  if (alreadyPosted.length > 0) {
    console.log(`Already posted for ${bill.period.label}: ${alreadyPosted.join(", ")}. Remaining: ${toPost.map((s) => s.category).join(", ")}.`);
  }

  const proceed = await confirm(`Post ${toPost.length} expense(s) to the "${GROUP_NAME}" Splitwise group?`);
  if (!proceed) {
    console.log("Aborted -- nothing was posted.");
    return;
  }

  console.log(`Resolving "${GROUP_NAME}" Splitwise group...`);
  const group = await findGroupByName(GROUP_NAME);
  const userIdByEmail = resolveUserIdsByEmail(group);

  const created: { id: number; description: string }[] = [];
  for (const split of toPost) {
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

      alreadyPosted.push(split.category);
      state.periods[periodKey] = { postedCategories: alreadyPosted };
      saveState(state); // save immediately so partial progress survives a later failure/crash
    } catch (err) {
      console.error(`\nFailed to post "${split.title}" -- likely Splitwise's daily rate limit: ${err instanceof Error ? err.message : err}`);
      break; // don't keep hammering the API once one call fails
    }
  }

  const stillPending = postable.filter((s) => !alreadyPosted.includes(s.category));
  console.log(`\n${created.length} expense(s) posted this run.`);
  if (stillPending.length > 0) {
    console.log(`Still pending for ${bill.period.label}: ${stillPending.map((s) => s.category).join(", ")}. Run \`npm run sync\` again (e.g. tomorrow) to post the rest.`);
  } else {
    console.log("All categories for this bill period are now posted.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
