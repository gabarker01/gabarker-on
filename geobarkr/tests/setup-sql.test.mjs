// setup.sql (the one file to paste into Supabase) must match the migrations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dir = new URL("../supabase/", import.meta.url);
const read = (name) => readFileSync(new URL(name, dir), "utf8");

test("setup.sql is migrations 001-003 then seed.sql", () => {
  const parts = ["migrations/001_schema.sql", "migrations/002_functions.sql", "migrations/003_security.sql", "seed.sql"];
  const body = parts.map((p) => read(p) + "\n").join("");
  const setup = read("setup.sql");
  assert.ok(setup.endsWith(body), "setup.sql is out of date: rebuild it from the migrations and seed");
});
