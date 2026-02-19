/**
 * fs-utils.ts — Shared file system utilities.
 */
import { existsSync, readFileSync } from "fs";

export function safeReadFile(filePath: string): string {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, "utf-8");
    }
  } catch {
    // ignore — optional file
  }
  return "";
}
