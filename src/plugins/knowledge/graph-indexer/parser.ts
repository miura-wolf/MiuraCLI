/**
 * GraphParser — tree-sitter WASM-based parser for TS/JS/Go/Python.
 *
 * Uses web-tree-sitter (WASM) + language-specific WASM parsers.
 * This avoids native C++ compilation that fails on Node 26 / Windows.
 */

import { Parser, Language, type Node } from 'web-tree-sitter';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ParsedSymbol, Language as GraphLang } from './types.js';

// WASM paths — resolved from module location
const _wasmDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../../node_modules');

interface LoadedLang {
  lang: Language;
  treeSitterLang: GraphLang;
  symbolTypes: Record<string, string>;
}

let _initialized = false;
let _langs: Record<string, LoadedLang> = {};
let _parser: Parser;

const TS_SYMBOL_TYPES: Record<string, string> = {
  function_declaration: 'function',
  method_definition: 'method',
  class_declaration: 'class',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  variable_declarator: 'variable',
  import_specifier: 'import',
  import_clause: 'import',
  export_named_declaration: 'variable',
  enum_declaration: 'enum',
  lexical_declaration: 'variable',
  arrow_function: 'function',
};

const GO_SYMBOL_TYPES: Record<string, string> = {
  function_declaration: 'function',
  method_declaration: 'method',
  type_declaration: 'type',
  type_spec: 'class',
  var_declaration: 'variable',
  const_declaration: 'variable',
  import_specifier: 'import',
  import_declaration: 'import',
};

const PY_SYMBOL_TYPES: Record<string, string> = {
  function_definition: 'function',
  class_definition: 'class',
  assignment: 'variable',
  import_statement: 'import',
  import_from_statement: 'import',
};

function loadWasm(name: string): Uint8Array {
  const path = `${_wasmDir}/${name}`;
  const buf = readFileSync(path);
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/**
 * Initialize all language parsers. Call once at startup.
 */
export async function initParsers(): Promise<void> {
  if (_initialized) return;

  await Parser.init();

  _parser = new Parser();

  const tsLang = await Language.load(loadWasm('tree-sitter-typescript/tree-sitter-typescript.wasm'));
  const jsLang = await Language.load(loadWasm('tree-sitter-javascript/tree-sitter-javascript.wasm'));
  const goLang = await Language.load(loadWasm('tree-sitter-go/tree-sitter-go.wasm'));
  const pyLang = await Language.load(loadWasm('tree-sitter-python/tree-sitter-python.wasm'));

  _langs = {
    typescript: { lang: tsLang, treeSitterLang: 'typescript' as GraphLang, symbolTypes: TS_SYMBOL_TYPES },
    tsx:        { lang: tsLang, treeSitterLang: 'tsx'        as GraphLang, symbolTypes: TS_SYMBOL_TYPES },
    javascript: { lang: jsLang, treeSitterLang: 'javascript' as GraphLang, symbolTypes: TS_SYMBOL_TYPES },
    go:         { lang: goLang, treeSitterLang: 'go'         as GraphLang, symbolTypes: GO_SYMBOL_TYPES },
    python:     { lang: pyLang, treeSitterLang: 'python'     as GraphLang, symbolTypes: PY_SYMBOL_TYPES },
  };

  _initialized = true;
}

/** Detect language from file extension. */
export function detectLanguage(filePath: string): GraphLang {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':  return 'typescript';
    case 'tsx': return 'tsx';
    case 'js':
    case 'mjs':
    case 'cjs': return 'javascript';
    case 'go':  return 'go';
    case 'py':  return 'python';
    default:    return 'unknown';
  }
}

/** Parse a file and extract all named symbols. */
export function parseFile(source: string, filePath: string): ParsedSymbol[] {
  if (!_initialized) throw new Error('Parsers not initialized — call initParsers() first');

  const langKey = detectLanguage(filePath);
  if (langKey === 'unknown') return [];

  const loaded = _langs[langKey] ?? _langs['typescript'];
  _parser.setLanguage(loaded.lang);

  const tree = _parser.parse(source);
  if (!tree) return [];
  const root = tree.rootNode;
  const symbols: ParsedSymbol[] = [];

  function walk(node: Node): void {
    const type = node.type;
    const myType = loaded.symbolTypes[type];

    if (myType && node.isNamed) {
      const nameNode = getNameNode(node);
      const sigNode = getSignatureNode(node);

      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          type: myType as ParsedSymbol['type'],
          signature: sigNode?.text,
          line: nameNode.startPosition.row + 1,
          column: nameNode.startPosition.column,
          endLine: node.endPosition.row + 1,
          endColumn: node.endPosition.column,
        });
      }
    }

    for (const child of node.namedChildren) {
      // Skip noise nodes
      if (
        type === 'import_statement' ||
        type === 'import_declaration' ||
        type === 'import_from_statement' ||
        type === 'export_clause'
      ) {
        continue;
      }
      walk(child);
    }
  }

  walk(root);
  return symbols;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function getNameNode(node: Node): Node | null {
  // Try field names first
  for (const f of ['name', 'declarator', 'left', 'identifier', 'function']) {
    const child = node.childForFieldName(f);
    if (child?.type === 'identifier') return child;
    if (child?.type === 'property_identifier') return child;
    if (child?.type === 'type_identifier') return child;
    if (child?.type === 'field_identifier') return child;
    if (child?.type === 'word') return child;
    if (child?.isNamed) return child; // fallback to first named child
  }
  // Fallback: first identifier in children
  for (const c of node.children) {
    if (c.type === 'identifier') return c;
    if (c.type === 'property_identifier') return c;
    if (c.type === 'type_identifier') return c;
  }
  return null;
}

function getSignatureNode(node: Node): Node | null {
  switch (node.type) {
    case 'function_declaration':
    case 'function_expression':
    case 'method_definition':
    case 'function_definition':
      return node.childForFieldName('parameters') ?? null;
    default:
      return null;
  }
}

/**
 * Extract call edges from a parsed file using regex heuristics.
 * Looks for `identifier(args)` patterns to find call targets.
 */
export function extractCallEdges(
  source: string,
  symbols: ParsedSymbol[],
): Array<{ from: ParsedSymbol; toName: string }> {
  const edges: Array<{ from: ParsedSymbol; toName: string }> = [];

  const callPattern = /(?<caller>(?:[\w$][\w0-9$]*\.)*[\w$][\w0-9$]*)\s*\(/g;

  for (const sym of symbols) {
    if (sym.line < 1) continue;

    // Build a window around the symbol's body (skip signature)
    const lines = source.split('\n');
    const windowLines = lines.slice(Math.min(sym.line, lines.length) - 1, Math.min(sym.line + 100, lines.length));
    const bodyWindow = windowLines.join('\n');

    let match: RegExpExecArray | null;
    callPattern.lastIndex = 0;
    while ((match = callPattern.exec(bodyWindow)) !== null) {
      const calledName = match.groups!.caller;
      const base = calledName.split('.').pop() ?? calledName;
      if (base && base !== sym.name && /^[a-zA-Z_$]/.test(base)) {
        edges.push({ from: sym, toName: base });
      }
    }
  }

  return edges;
}