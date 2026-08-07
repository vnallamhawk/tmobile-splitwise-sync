import { BillData } from "../../src/parseBill";
import { PeopleConfig } from "../../config/people";

/**
 * Entirely fake data mirroring config/people.example.json, exercising every split rule:
 * an evenly-divided account base charge, a family-absorbed line with its own itemized plan
 * charge, a wearable, and per-line equipment/services/one-time charges.
 */
export const samplePeopleConfig: PeopleConfig = {
  rakeshPhone: "(555) 000-0001",
  wearablePhone: "(555) 000-0099",
  people: [
    { phone: "(555) 000-0001", name: "Alex Payer", splitwiseEmail: "alex@example.com" },
    { phone: "(555) 000-0002", name: "Blair Member", splitwiseEmail: "blair@example.com" },
    { phone: "(555) 000-0003", name: "Casey Member", splitwiseEmail: "casey@example.com" },
    { phone: "(555) 000-0004", name: "Drew Member", splitwiseEmail: "drew@example.com" },
    { phone: "(555) 000-0005", name: "Family Member (absorbed by Alex)" },
    { phone: "(555) 000-0006", name: "Family Member (absorbed by Blair)" },
  ],
  familyFold: {
    "(555) 000-0005": "(555) 000-0001",
    "(555) 000-0006": "(555) 000-0002",
  },
};

export const sampleBill: BillData = {
  period: { start: new Date("2026-06-09"), end: new Date("2026-07-08"), label: "Jun 9 - jul 8" },
  totalDue: 392,
  totals: { plans: 342, equipment: 30, services: 15, oneTime: 5, total: 392 },
  lines: [
    { phone: "Account", lineType: "Account", plans: 300, equipment: null, services: 0, oneTime: null, total: 300 },
    { phone: "(555) 000-0001", lineType: "Voice", plans: "included", equipment: null, services: null, oneTime: null, total: 0 },
    { phone: "(555) 000-0002", lineType: "Voice", plans: "included", equipment: null, services: null, oneTime: null, total: 0 },
    { phone: "(555) 000-0003", lineType: "Voice", plans: "included", equipment: 20, services: null, oneTime: null, total: 20 },
    { phone: "(555) 000-0004", lineType: "Voice", plans: "included", equipment: null, services: 15, oneTime: null, total: 15 },
    { phone: "(555) 000-0006", lineType: "Voice", plans: "included", equipment: null, services: null, oneTime: null, total: 0 },
    { phone: "(555) 000-0005", lineType: "Voice", plans: 30, equipment: 10, services: null, oneTime: 5, total: 45 },
    { phone: "(555) 000-0099", lineType: "Wearable", plans: 12, equipment: null, services: null, oneTime: null, total: 12 },
  ],
};
