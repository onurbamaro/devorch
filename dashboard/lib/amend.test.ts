// Contract under test: responder-conflito.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { appendAmendment, clearConflict } from "./amend";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixture(opts?: { contract?: string; decisions?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "devorch-amend-"));
  dirs.push(dir);
  mkdirSync(join(dir, "spec"), { recursive: true });
  const session = {
    name: "test",
    stage: "blocked-on-spec",
    foo: "keep-me",
    notes: ["x"],
    specConflicts: [
      {
        phase: "build",
        contract: opts?.contract ?? "checkout-pix",
        evidence: "QR ausente",
        options: ["A", "B"],
        recommendation: "B",
      },
    ],
  };
  writeFileSync(join(dir, "session.json"), JSON.stringify(session, null, 2) + "\n");
  writeFileSync(join(dir, "spec", "decisions.md"), opts?.decisions ?? "# Decisions: Test\n");
  return dir;
}

test("appendAmendment writes the dated amendment block", () => {
  const today = new Date().toISOString().slice(0, 10);
  const dir = fixture();
  expect(appendAmendment(dir, { contract: "checkout-pix", decisionText: "Usar QR estático." })).toEqual({
    already: false,
  });
  expect(readFileSync(join(dir, "spec", "decisions.md"), "utf-8")).toBe(
    "# Decisions: Test\n" +
      `## Amendment (${today}): checkout-pix\n` +
      "- **Conflict**: QR ausente\n" +
      "- **Decision**: Usar QR estático.\n",
  );
});

test("clearConflict removes only the matching specConflicts entry", () => {
  const dir = fixture();
  expect(clearConflict(dir, "checkout-pix")).toEqual({ already: false });
  const parsed: unknown = JSON.parse(readFileSync(join(dir, "session.json"), "utf-8"));
  expect(parsed).toEqual({
    name: "test",
    stage: "blocked-on-spec",
    foo: "keep-me",
    notes: ["x"],
    specConflicts: [],
  });
});

test("second appendAmendment and clearConflict are no-ops after the conflict is cleared", () => {
  const dir = fixture();
  expect(appendAmendment(dir, { contract: "checkout-pix", decisionText: "Keep PIX." })).toEqual({
    already: false,
  });
  expect(clearConflict(dir, "checkout-pix")).toEqual({ already: false });
  expect(appendAmendment(dir, { contract: "checkout-pix", decisionText: "Keep PIX." })).toEqual({
    already: true,
  });
  const text = readFileSync(join(dir, "spec", "decisions.md"), "utf-8");
  expect(text.split("## Amendment").length - 1).toBe(1);
  expect(clearConflict(dir, "checkout-pix")).toEqual({ already: true });
});

test("appendAmendment does not change decisions.md when the contract is absent", () => {
  const dir = fixture();
  const before = readFileSync(join(dir, "spec", "decisions.md"), "utf-8");
  expect(appendAmendment(dir, { contract: "missing-contract", decisionText: "nope" })).toEqual({
    already: true,
  });
  expect(readFileSync(join(dir, "spec", "decisions.md"), "utf-8")).toBe(before);
});
