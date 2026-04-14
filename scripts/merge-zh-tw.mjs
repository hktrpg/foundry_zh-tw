/**
 * Merge zh-tw translations to match en.json structure exactly.
 * Handles legacy zh-tw files with duplicate root keys (JSON.parse drops earlier keys).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function isPlainObject(x) {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

function deepMerge(a, b) {
  if (b === undefined) return a;
  if (typeof b === "string" || typeof a === "string") return b;
  if (!isPlainObject(a) || !isPlainObject(b)) return b;
  const out = { ...a };
  for (const k of Object.keys(b)) {
    if (isPlainObject(a[k]) && isPlainObject(b[k])) out[k] = deepMerge(a[k], b[k]);
    else out[k] = b[k];
  }
  return out;
}

/**
 * Legacy file may append a v14 overlay with duplicate root keys.
 * Split before the second block that only adds ADVENTURE.ImportLoading, then deep-merge both parses.
 */
function parseLegacyZhTwWithDuplicateMerge(text) {
  const marker = '\n  "ADVENTURE": {\n    "ImportLoading"';
  const splitPos = text.indexOf(marker);
  if (splitPos === -1) {
    return JSON.parse(text);
  }
  const head = text.slice(0, splitPos).replace(/,\s*$/, "").trimEnd() + "\n}";
  const tail =
    "{" + text.slice(splitPos + 1).trimStart();
  const a = JSON.parse(head);
  const b = JSON.parse(tail);
  return deepMerge(a, b);
}

/** Flatten: path uses "." between segments; object keys are literal (may contain dots). */
function flattenStrings(obj, prefix = "") {
  const out = {};
  function walk(node, p) {
    if (typeof node === "string") {
      if (p) out[p] = node;
      return;
    }
    if (!isPlainObject(node)) return;
    for (const [k, v] of Object.entries(node)) {
      const next = p ? `${p}.${k}` : k;
      walk(v, next);
    }
  }
  walk(obj, prefix);
  return out;
}

function splitZhTwLegacy(raw) {
  const flat = {};
  const trees = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") flat[k] = v;
    else if (isPlainObject(v)) trees[k] = v;
  }
  return { flat, trees };
}

/** Build lookup: flat entries + flattened nested trees (trees override flat on conflict). */
function legacyToLookup(legacyJson) {
  const { flat, trees } = splitZhTwLegacy(legacyJson);
  const fromFlat = flattenStrings(flat);
  let merged = { ...fromFlat };
  for (const [rootKey, tree] of Object.entries(trees)) {
    merged = { ...merged, ...flattenStrings(tree, rootKey) };
  }
  return merged;
}

/** Apply template shape from en; fill leaf strings from lookup, else keep English from en. */
function applyTemplate(enNode, lookup, enLookup, missing, path = "") {
  if (typeof enNode === "string") {
    const zh = lookup[path];
    if (zh === undefined) {
      missing.push({ path, en: enLookup[path] ?? enNode });
      return enNode;
    }
    return zh;
  }
  if (!isPlainObject(enNode)) return enNode;
  const out = {};
  for (const key of Object.keys(enNode)) {
    const p = path ? `${path}.${key}` : key;
    out[key] = applyTemplate(enNode[key], lookup, enLookup, missing, p);
  }
  return out;
}

function countStrings(node) {
  if (typeof node === "string") return 1;
  if (!isPlainObject(node)) return 0;
  let n = 0;
  for (const k of Object.keys(node)) n += countStrings(node[k]);
  return n;
}

const enPath = path.join(root, "src/v14.360/en.json");
const v14Path = path.join(root, "src/v14.360/v14-zh-tw.json");
const zhPath = path.join(root, "zh-tw.json");
const legacyBackupPath = path.join(root, "_zh-tw-head.json");

const en = JSON.parse(fs.readFileSync(enPath, "utf8"));
const v14 = JSON.parse(fs.readFileSync(v14Path, "utf8"));

const rawText = fs.existsSync(legacyBackupPath)
  ? fs.readFileSync(legacyBackupPath, "utf8")
  : fs.readFileSync(zhPath, "utf8");

let zhLegacy;
try {
  zhLegacy = parseLegacyZhTwWithDuplicateMerge(rawText);
} catch (e) {
  console.warn("Duplicate-merge parse failed, falling back to JSON.parse:", e.message);
  zhLegacy = JSON.parse(rawText);
}

const enLookup = flattenStrings(en);
const legacyLookup = legacyToLookup(zhLegacy);
const v14Lookup = flattenStrings(v14);

const lookup = { ...legacyLookup, ...v14Lookup };

const missing = [];
const structured = applyTemplate(en, lookup, enLookup, missing);

console.log("en.json leaf count:", countStrings(en));
console.log("legacy lookup keys:", Object.keys(legacyLookup).length);
console.log("v14 lookup keys:", Object.keys(v14Lookup).length);
console.log("merged lookup keys:", Object.keys(lookup).length);
console.log("missing (no zh string):", missing.length);

fs.writeFileSync(zhPath, JSON.stringify(structured, null, 2) + "\n", "utf8");

if (missing.length) {
  const reportPath = path.join(root, "scripts", "missing-zh.json");
  fs.writeFileSync(reportPath, JSON.stringify(missing, null, 2), "utf8");
  console.log("Wrote", reportPath);
}

console.log("Wrote zh-tw.json");
