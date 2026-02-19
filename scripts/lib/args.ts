/**
 * args.ts — Shared library for CLI argument parsing.
 * Canonical implementation of parseArgs for --flag value pairs.
 */

export interface FlagDef {
  name: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
}

export function parseArgs<T>(defs: FlagDef[]): T {
  const argv = process.argv.slice(2);
  const result: Record<string, string | number | boolean> = {};

  // Set defaults
  for (const def of defs) {
    if (def.type === "boolean") {
      result[def.name] = false;
    } else if (def.type === "number") {
      result[def.name] = 0;
    } else {
      result[def.name] = "";
    }
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Handle --no-flag for booleans
    if (arg.startsWith("--no-")) {
      const flagName = arg.slice(5);
      const def = defs.find((d) => d.name === flagName);
      if (def && def.type === "boolean") {
        result[flagName] = false;
        continue;
      }
    }

    if (arg.startsWith("--")) {
      const flagName = arg.slice(2);
      const def = defs.find((d) => d.name === flagName);
      if (!def) continue;

      if (def.type === "boolean") {
        result[flagName] = true;
      } else if (argv[i + 1]) {
        const val = argv[++i];
        result[flagName] = def.type === "number" ? parseInt(val, 10) : val;
      }
    }
  }

  // Validate required flags
  const missing: string[] = [];
  for (const def of defs) {
    if (!def.required) continue;
    const val = result[def.name];
    if (def.type === "string" && !val) missing.push(def.name);
    else if (def.type === "number" && val === 0) missing.push(def.name);
  }

  if (missing.length > 0) {
    console.error(`Missing required flags: ${missing.map((f) => `--${f}`).join(", ")}`);
    process.exit(1);
  }

  return result as T;
}
