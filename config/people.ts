import fs from "node:fs";
import path from "node:path";

export interface Person {
  phone: string;
  name: string;
  /** Splitwise account email. Absent for family members who are never billed directly. */
  splitwiseEmail?: string;
}

export interface PeopleConfig {
  rakeshPhone: string;
  wearablePhone: string;
  people: Person[];
  /** Family lines whose charges are folded into the absorbing person's own share instead of being billed to the group. */
  familyFold: Record<string, string>;
}

const REAL_CONFIG_PATH = path.resolve("config/people.json");
const EXAMPLE_CONFIG_PATH = path.resolve("config/people.example.json");

/**
 * config/people.json holds real names/emails and is gitignored -- see config/people.example.json
 * for the shape and a `cp` template. Falls back to the example (fake data) so the project still
 * runs out of the box on a fresh clone.
 */
function loadConfig(): PeopleConfig {
  const configPath = fs.existsSync(REAL_CONFIG_PATH) ? REAL_CONFIG_PATH : EXAMPLE_CONFIG_PATH;
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

export const peopleConfig: PeopleConfig = loadConfig();

export function findPerson(config: PeopleConfig, phone: string): Person {
  const person = config.people.find((p) => p.phone === phone);
  if (!person) throw new Error(`Unknown phone number on bill: ${phone}`);
  return person;
}

/** Resolves a phone number to the person who actually bears the cost, after family folding. */
export function resolveBearer(config: PeopleConfig, phone: string): Person {
  const foldedPhone = config.familyFold[phone] ?? phone;
  return findPerson(config, foldedPhone);
}
