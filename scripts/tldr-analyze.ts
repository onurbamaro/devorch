/**
 * tldr-analyze.ts — Structural TypeScript analysis using ts-morph.
 * Extracts exports, imports, functions, and types from TS files.
 * Usage: bun ~/.claude/devorch-scripts/tldr-analyze.ts --files path1,path2,... [--root projectRoot]
 * Output: JSON to stdout with minimal-token summaries.
 */
import { resolve } from "path";
import { Project, SyntaxKind, Node } from "ts-morph";

// --- Types ---

interface ExportInfo {
  name: string;
  kind: "function" | "class" | "type" | "interface" | "const" | "enum";
  signature?: string;
}

interface ImportInfo {
  from: string;
  names: string[];
}

interface FunctionInfo {
  name: string;
  params: string;
  returnType: string;
  isAsync: boolean;
  isExported: boolean;
}

interface TypeInfo {
  name: string;
  kind: "type" | "interface" | "enum";
  members?: string[];
}

interface FileAnalysis {
  exports: ExportInfo[];
  imports: ImportInfo[];
  functions: FunctionInfo[];
  types: TypeInfo[];
}

interface AnalysisResult {
  files: Record<string, FileAnalysis>;
  warnings: string[];
  tokenEstimate: number;
}

// --- Arrow helpers ---

const parseCliArgs = (): { files: string[]; root: string } => {
  const argv = process.argv.slice(2);
  let filesRaw = "";
  let root = process.cwd();

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--files" && argv[i + 1]) {
      filesRaw = argv[++i];
    } else if (argv[i] === "--root" && argv[i + 1]) {
      root = argv[++i];
    }
  }

  const files = filesRaw
    ? filesRaw.split(",").map((f) => f.trim()).filter(Boolean)
    : [];

  return { files, root };
};

const resolveFilePaths = (files: string[], root: string): string[] =>
  files.map((f) => resolve(root, f));

const getExportKind = (node: Node): ExportInfo["kind"] => {
  if (Node.isFunctionDeclaration(node)) return "function";
  if (Node.isClassDeclaration(node)) return "class";
  if (Node.isTypeAliasDeclaration(node)) return "type";
  if (Node.isInterfaceDeclaration(node)) return "interface";
  if (Node.isEnumDeclaration(node)) return "enum";
  if (Node.isVariableDeclaration(node)) return "const";
  if (Node.isVariableStatement(node)) return "const";
  return "const";
};

const getExportSignature = (node: Node): string | undefined => {
  if (Node.isFunctionDeclaration(node)) {
    const fn = node;
    const params = fn.getParameters().map((p) => {
      const typeText = p.getTypeNode()?.getText() ?? p.getType().getText();
      return `${p.getName()}: ${typeText}`;
    }).join(", ");
    const ret = fn.getReturnTypeNode()?.getText() ?? fn.getReturnType().getText();
    return `(${params}) => ${ret}`;
  }
  if (Node.isClassDeclaration(node)) {
    const cls = node;
    const heritage = cls.getHeritageClauses().map((h) => h.getText()).join(" ");
    return heritage || undefined;
  }
  return undefined;
};

const extractExports = (sourceFile: import("ts-morph").SourceFile): ExportInfo[] => {
  const exports: ExportInfo[] = [];

  // Exported declarations (functions, classes, types, interfaces, enums)
  for (const decl of sourceFile.getExportedDeclarations()) {
    const [name, nodes] = decl;
    for (const node of nodes) {
      const kind = getExportKind(node);
      const signature = getExportSignature(node);
      const entry: ExportInfo = { name, kind };
      if (signature) entry.signature = signature;
      exports.push(entry);
    }
  }

  return exports;
};

const extractImports = (sourceFile: import("ts-morph").SourceFile): ImportInfo[] => {
  const imports: ImportInfo[] = [];

  for (const imp of sourceFile.getImportDeclarations()) {
    const from = imp.getModuleSpecifierValue();
    const names: string[] = [];

    const defaultImport = imp.getDefaultImport();
    if (defaultImport) names.push(defaultImport.getText());

    const namespaceImport = imp.getNamespaceImport();
    if (namespaceImport) names.push(`* as ${namespaceImport.getText()}`);

    for (const named of imp.getNamedImports()) {
      const alias = named.getAliasNode();
      if (alias) {
        names.push(`${named.getName()} as ${alias.getText()}`);
      } else {
        names.push(named.getName());
      }
    }

    if (names.length > 0) {
      imports.push({ from, names });
    }
  }

  return imports;
};

const extractFunctions = (sourceFile: import("ts-morph").SourceFile): FunctionInfo[] => {
  const functions: FunctionInfo[] = [];

  // Top-level function declarations
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName() ?? "(anonymous)";
    const params = fn.getParameters().map((p) => {
      const typeText = p.getTypeNode()?.getText() ?? p.getType().getText();
      return `${p.getName()}: ${typeText}`;
    }).join(", ");
    const returnType = fn.getReturnTypeNode()?.getText() ?? fn.getReturnType().getText();
    const isAsync = fn.isAsync();
    const isExported = fn.isExported();
    functions.push({ name, params, returnType, isAsync, isExported });
  }

  // Top-level arrow functions in variable declarations
  for (const stmt of sourceFile.getVariableStatements()) {
    const isExported = stmt.isExported();
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializerIfKind(SyntaxKind.ArrowFunction);
      if (!init) continue;

      const name = decl.getName();
      const params = init.getParameters().map((p) => {
        const typeText = p.getTypeNode()?.getText() ?? p.getType().getText();
        return `${p.getName()}: ${typeText}`;
      }).join(", ");
      const returnType = init.getReturnTypeNode()?.getText() ?? init.getReturnType().getText();
      const isAsync = init.isAsync();
      functions.push({ name, params, returnType, isAsync, isExported });
    }
  }

  return functions;
};

const extractTypes = (sourceFile: import("ts-morph").SourceFile): TypeInfo[] => {
  const types: TypeInfo[] = [];

  // Interfaces
  for (const iface of sourceFile.getInterfaces()) {
    const members = iface.getMembers().map((m) => {
      if (Node.isPropertySignature(m)) {
        const typeText = m.getTypeNode()?.getText() ?? m.getType().getText();
        return `${m.getName()}: ${typeText}`;
      }
      if (Node.isMethodSignature(m)) {
        return m.getText().replace(/\s+/g, " ").trim();
      }
      return m.getText().replace(/\s+/g, " ").trim();
    });
    types.push({ name: iface.getName(), kind: "interface", members });
  }

  // Type aliases
  for (const alias of sourceFile.getTypeAliases()) {
    types.push({ name: alias.getName(), kind: "type" });
  }

  // Enums
  for (const en of sourceFile.getEnums()) {
    const members = en.getMembers().map((m) => m.getName());
    types.push({ name: en.getName(), kind: "enum", members });
  }

  return types;
};

const analyzeFile = (
  project: Project,
  filePath: string,
  warnings: string[]
): FileAnalysis | null => {
  try {
    const sourceFile = project.addSourceFileAtPath(filePath);
    const exports = extractExports(sourceFile);
    const imports = extractImports(sourceFile);
    const functions = extractFunctions(sourceFile);
    const types = extractTypes(sourceFile);
    return { exports, imports, functions, types };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    warnings.push(`Failed to parse: ${filePath} (${reason})`);
    return null;
  }
};

const estimateTokens = (json: string): number => Math.ceil(json.length / 4);

// --- Main logic ---

const { files, root } = parseCliArgs();

if (files.length === 0) {
  const result: AnalysisResult = {
    files: {},
    warnings: ["No TypeScript files found"],
    tokenEstimate: 0,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const resolvedPaths = resolveFilePaths(files, root);

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
});

const warnings: string[] = [];
const analysisFiles: Record<string, FileAnalysis> = {};

for (const filePath of resolvedPaths) {
  const analysis = analyzeFile(project, filePath, warnings);
  if (analysis) {
    analysisFiles[filePath] = analysis;
  }
}

const partialResult = {
  files: analysisFiles,
  warnings,
  tokenEstimate: 0,
};

const jsonWithoutEstimate = JSON.stringify(partialResult, null, 2);
const tokenEstimate = estimateTokens(jsonWithoutEstimate);

const result: AnalysisResult = {
  files: analysisFiles,
  warnings,
  tokenEstimate,
};

console.log(JSON.stringify(result, null, 2));
