import fs from "fs";
import path from "path";
import { parseBillPdf } from "../src/parseBill";

// This uses the real T-Mobile bill PDF, which contains a real account number/address
// and is gitignored -- it only exists on machines that placed a real bill there for
// local testing. On a fresh clone (e.g. CI, or anyone browsing this repo), this test
// is skipped rather than failing.
const FIXTURE_PATH = path.join(process.cwd(), "test/fixtures/2026-07-BillSummary.pdf");
const describeIfFixture = fs.existsSync(FIXTURE_PATH) ? describe : describe.skip;

describeIfFixture("parseBillPdf (real bill fixture, local-only)", () => {
  it("parses the July 2026 bill PDF", async () => {
    const buf = fs.readFileSync(FIXTURE_PATH);
    const bill = await parseBillPdf(buf);

    expect(bill.period.label).toBe("Jun 9 - jul 8");
    expect(bill.totalDue).toBe(413.35);
    expect(bill.totals).toEqual({ plans: 347, equipment: 35, services: 18.5, oneTime: 12.85, total: 413.35 });
    expect(bill.lines).toHaveLength(12); // Account + 10 voice lines + 1 wearable

    const account = bill.lines.find((l) => l.lineType === "Account")!;
    expect(account.plans).toBe(300);

    const wearable = bill.lines.find((l) => l.lineType === "Wearable")!;
    expect(wearable.phone).toBe("(623) 286-7024");
    expect(wearable.plans).toBe(12);
  });
});
