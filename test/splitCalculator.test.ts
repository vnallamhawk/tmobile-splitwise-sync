import { computeSplits, OwedShare } from "../src/splitCalculator";
import { sampleBill, samplePeopleConfig } from "./fixtures/sample-bill";

function shareFor(shares: OwedShare[], email: string): number | undefined {
  return shares.find((s) => s.email === email)?.amount;
}

describe("computeSplits (synthetic fixture)", () => {
  it("every category's owed shares sum exactly to the bill's category total", () => {
    const splits = computeSplits(sampleBill, samplePeopleConfig);
    for (const split of splits) {
      const sum = split.owedShares.reduce((a, s) => a + s.amount, 0);
      expect(Math.round(sum * 100)).toBe(Math.round(split.total * 100));
    }
  });

  it("Plans: splits the $300 account base across 5 included lines, folds the two family lines into Alex/Blair, and folds the wearable + the family line's own itemized $30 charge into Alex", () => {
    const [plans] = computeSplits(sampleBill, samplePeopleConfig);
    expect(plans.category).toBe("plans");
    expect(plans.title).toBe("Jun 9 - jul 8 plans");
    expect(plans.total).toBe(342);
    expect(plans.personalOnly).toBe(false);

    // Alex: his own $60 base share + family's itemized $30 + wearable $12 = $102
    expect(shareFor(plans.owedShares, "alex@example.com")).toBe(102);
    // Blair: her own $60 base share + family's $60 base share = $120
    expect(shareFor(plans.owedShares, "blair@example.com")).toBe(120);
    // Casey and Drew: plain $60 base shares
    expect(shareFor(plans.owedShares, "casey@example.com")).toBe(60);
    expect(shareFor(plans.owedShares, "drew@example.com")).toBe(60);
  });

  it("Equipment: Casey owes her $20 installment in full, the family line's $10 installment folds into Alex", () => {
    const [, equipment] = computeSplits(sampleBill, samplePeopleConfig);
    expect(equipment.category).toBe("equipment");
    expect(equipment.total).toBe(30);
    expect(equipment.personalOnly).toBe(false);
    expect(shareFor(equipment.owedShares, "casey@example.com")).toBe(20);
    expect(shareFor(equipment.owedShares, "alex@example.com")).toBe(10);
  });

  it("Services: Drew owes her $15 service charge in full", () => {
    const [, , services] = computeSplits(sampleBill, samplePeopleConfig);
    expect(services.category).toBe("services");
    expect(services.title).toBe("Jun 9 - jul 8 intl");
    expect(services.total).toBe(15);
    expect(services.personalOnly).toBe(false);
    expect(shareFor(services.owedShares, "drew@example.com")).toBe(15);
  });

  it("One-time charges: the family line's $5 usage charge folds entirely into Alex -- personalOnly, not posted", () => {
    const [, , , oneTime] = computeSplits(sampleBill, samplePeopleConfig);
    expect(oneTime.category).toBe("oneTime");
    expect(oneTime.total).toBe(5);
    expect(oneTime.personalOnly).toBe(true);
    expect(shareFor(oneTime.owedShares, "alex@example.com")).toBe(5);
  });

  it("distributes an account base charge that doesn't divide evenly using the largest-remainder method (no lost or duplicated cents)", () => {
    // $10.00 base split across 3 included lines -> $3.34/$3.33/$3.33, summing exactly to $10.
    const unevenBill = {
      period: sampleBill.period,
      totalDue: 10,
      totals: { plans: 10, equipment: 0, services: 0, oneTime: 0, total: 10 },
      lines: [
        { phone: "Account", lineType: "Account" as const, plans: 10, equipment: null, services: 0, oneTime: null, total: 10 },
        { phone: "(555) 000-0001", lineType: "Voice" as const, plans: "included" as const, equipment: null, services: null, oneTime: null, total: 0 },
        { phone: "(555) 000-0002", lineType: "Voice" as const, plans: "included" as const, equipment: null, services: null, oneTime: null, total: 0 },
        { phone: "(555) 000-0003", lineType: "Voice" as const, plans: "included" as const, equipment: null, services: null, oneTime: null, total: 0 },
      ],
    };

    const [plans] = computeSplits(unevenBill, samplePeopleConfig);
    const sum = plans.owedShares.reduce((a, s) => a + s.amount, 0);
    expect(Math.round(sum * 100)).toBe(1000);
    const amounts = plans.owedShares.map((s) => s.amount).sort();
    expect(amounts).toEqual([3.33, 3.33, 3.34]);
  });
});
