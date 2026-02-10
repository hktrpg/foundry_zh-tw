import fs from "node:fs/promises";
import path from "node:path";

const STATUS_SOURCES = [
  {
    id: "demo.foundryvtt.com",
    statusUrl: "https://demo.foundryvtt.com/api/status",
    langUrl: "https://demo.foundryvtt.com/lang/en.json"
  },
  {
    id: "fvtt.hktrpg.com",
    statusUrl: "https://fvtt.hktrpg.com/api/status",
    langUrl: "https://fvtt.hktrpg.com/lang/en.json"
  }
];

const ZH_FILE = "zh-tw.json";
const REPORT_PATH = path.join(".github", "translation-report.md");
const VERSION_CACHE_PATH = path.join(".github", "translation-version.json");

async function loadEnJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download en.json from ${url}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function loadStatus(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load status from ${url}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function loadVersionCache(rootDir) {
  const cachePath = path.join(rootDir, VERSION_CACHE_PATH);
  try {
    const data = await fs.readFile(cachePath, "utf8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveVersionCache(rootDir, cache) {
  const cachePath = path.join(rootDir, VERSION_CACHE_PATH);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), "utf8");
}

function parseVersionString(v) {
  if (typeof v !== "string") return null;
  const parts = v.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts;
}

function compareVersionStrings(a, b) {
  const pa = parseVersionString(a);
  const pb = parseVersionString(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

async function loadZhJson(rootDir) {
  const filePath = path.join(rootDir, ZH_FILE);
  const data = await fs.readFile(filePath, "utf8");
  return JSON.parse(data);
}

async function getZhFileMTime(rootDir) {
  const filePath = path.join(rootDir, ZH_FILE);
  const stats = await fs.stat(filePath);
  return stats.mtime.toISOString();
}

/**
 * Recursively flatten an object into dot-separated paths.
 * Keys are normalized to lowercase for comparison, but we also
 * retain the original path casing for reporting.
 */
function flattenObject(obj, prefix = "", out = [], originalPath = "") {
  if (obj === null || typeof obj !== "object") return out;

  for (const [key, value] of Object.entries(obj)) {
    const pathSegment = prefix ? `${prefix}.${key}` : key;
    const originalSegment = originalPath ? `${originalPath}.${key}` : key;

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      flattenObject(value, pathSegment, out, originalSegment);
    } else {
      const canonical = pathSegment.toLowerCase();
      out.push({
        canonical,
        path: originalSegment,
        value
      });
    }
  }

  return out;
}

function buildKeyIndex(flatEntries) {
  const index = new Map();
  for (const entry of flatEntries) {
    if (!index.has(entry.canonical)) {
      index.set(entry.canonical, entry);
    }
  }
  return index;
}

function generateReport({
  enIndex,
  zhIndex,
  missingKeys,
  obsoleteKeys,
  statusInfo,
  latestVersion,
  lastCheckedVersion,
  comparisonPerformed,
  selectedSourceId,
  selectedEnUrl,
  zhMTime,
  lastZhMTime
}) {
  const now = new Date().toISOString();

  const totalEn = enIndex.size;
  const totalZh = zhIndex.size;
  const missingCount = missingKeys.length;
  const obsoleteCount = obsoleteKeys.length;

  const lines = [];

  lines.push("# zh-TW Translation Key Report");
  lines.push("");
  lines.push(`Generated at: \`${now}\``);
  lines.push("");
  lines.push("## Status versions");
  lines.push("");

  for (const s of statusInfo) {
    lines.push(`- **${s.id}** \`${s.statusUrl}\` → version: \`${s.version ?? "unknown"}\``);
  }

  lines.push("");
  lines.push(`- **Latest detected version**: \`${latestVersion ?? "unknown"}\``);
  lines.push(`- **Last checked version**: \`${lastCheckedVersion ?? "none"}\``);
  lines.push(`- **Key comparison performed**: \`${comparisonPerformed ? "yes" : "no"}\``);
  lines.push(`- **Selected English source**: \`${selectedSourceId ?? "none"}\``);
  lines.push(`- **Selected en.json URL**: \`${selectedEnUrl ?? "n/a"}\``);
  lines.push(`- **Current zh-tw.json mtime**: \`${zhMTime ?? "unknown"}\``);
  lines.push(`- **Last recorded zh-tw.json mtime**: \`${lastZhMTime ?? "none"}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Source URL**: \`${selectedEnUrl ?? "n/a"}\``);
  lines.push(`- **Local file**: \`${ZH_FILE}\``);
  lines.push(`- **Total English keys**: ${totalEn}`);
  lines.push(`- **Total zh-TW keys**: ${totalZh}`);
  lines.push(`- **Missing translations** (present in English, missing in zh-TW): ${missingCount}`);
  lines.push(`- **Obsolete keys** (present in zh-TW, missing in English): ${obsoleteCount}`);
  lines.push("");

  lines.push("## Missing translations");
  lines.push("");
  if (!missingCount) {
    lines.push("All English keys have corresponding zh-TW entries (case-insensitive key comparison).");
  } else {
    lines.push("Keys that exist in `en.json` but are not found in `zh-tw.json` (after lowercasing and dot-path normalization).");
    lines.push("");
    lines.push("The following block can be copied directly into `zh-tw.json` (inside an object):");
    lines.push("");
    lines.push("```json");

    const MAX_ROWS = 500;
    const limited = missingKeys.slice(0, MAX_ROWS).map((canonical) => enIndex.get(canonical));
    // Sort by original path for a stable, readable order
    limited.sort((a, b) => a.path.localeCompare(b.path));

    for (const entry of limited) {
      const jsonValue = JSON.stringify(entry.value);
      lines.push(`"${entry.path}": ${jsonValue},`);
    }

    lines.push("```");

    if (missingKeys.length > MAX_ROWS) {
      lines.push("");
      lines.push(`_Output truncated: showing first ${MAX_ROWS} missing keys out of ${missingKeys.length} total._`);
    }
  }

  lines.push("");
  lines.push("## Obsolete keys");
  lines.push("");
  if (!obsoleteCount) {
    lines.push("No obsolete keys were found in `zh-tw.json`.");
  } else {
    lines.push("Keys that exist in `zh-tw.json` but are not found in `en.json` (after lowercasing and dot-path normalization):");
    lines.push("");
    lines.push("| Key |");
    lines.push("| --- |");

    const MAX_ROWS = 500;
    const limited = obsoleteKeys.slice(0, MAX_ROWS);

    for (const canonical of limited) {
      const entry = zhIndex.get(canonical);
      lines.push(`| \`${entry.path}\` |`);
    }

    if (obsoleteKeys.length > MAX_ROWS) {
      lines.push("");
      lines.push(`_Output truncated: showing first ${MAX_ROWS} obsolete keys out of ${obsoleteKeys.length} total._`);
    }
  }

  lines.push("");
  lines.push("> Note: Key comparison is performed using dot-separated paths and is case-insensitive (paths are lowercased).");
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const repoRoot = process.cwd();

  console.log("Loading status from configured sources ...");
  const statusInfo = [];
  for (const src of STATUS_SOURCES) {
    try {
      const data = await loadStatus(src.statusUrl);
      statusInfo.push({
        id: src.id,
        statusUrl: src.statusUrl,
        langUrl: src.langUrl,
        version: data.version ?? null
      });
    } catch (err) {
      console.error(String(err));
      statusInfo.push({
        id: src.id,
        statusUrl: src.statusUrl,
        langUrl: src.langUrl,
        version: null
      });
    }
  }

  const candidates = statusInfo.filter((s) => typeof s.version === "string");
  const selectedSource =
    candidates.length === 0
      ? null
      : candidates.reduce((acc, cur) => {
          if (!acc) return cur;
          return compareVersionStrings(acc.version, cur.version) >= 0 ? acc : cur;
        }, null);

  const latestVersion = selectedSource ? selectedSource.version : null;
  const selectedSourceId = selectedSource?.id ?? null;
  const selectedEnUrl = selectedSource?.langUrl ?? null;

  const existingCache = await loadVersionCache(repoRoot);
  const lastCheckedVersion = existingCache?.lastCheckedVersion ?? null;
  const lastZhMTime = existingCache?.lastZhMTime ?? null;

  let zhMTime = null;
  try {
    zhMTime = await getZhFileMTime(repoRoot);
  } catch (err) {
    console.error(`Failed to read mtime for ${ZH_FILE}: ${String(err)}`);
  }

  let shouldCompareKeys = false;
  if (!latestVersion || !lastCheckedVersion) {
    // No prior version information, perform an initial comparison.
    shouldCompareKeys = true;
  } else if (compareVersionStrings(latestVersion, lastCheckedVersion) > 0) {
    // Remote version increased.
    shouldCompareKeys = true;
  } else if (zhMTime && lastZhMTime && zhMTime > lastZhMTime) {
    // Local translation file changed since last check.
    shouldCompareKeys = true;
  }

  console.log(`Latest detected version: ${latestVersion ?? "unknown"}`);
  console.log(`Last checked version: ${lastCheckedVersion ?? "none"}`);
  console.log(`Current zh-tw.json mtime: ${zhMTime ?? "unknown"}`);
  console.log(`Last recorded zh-tw.json mtime: ${lastZhMTime ?? "none"}`);
  console.log(`Key comparison will ${shouldCompareKeys ? "" : "NOT "}be performed.`);

  let enIndex = new Map();
  let zhIndex = new Map();
  let missingKeys = [];
  let obsoleteKeys = [];

  if (shouldCompareKeys) {
    if (!selectedEnUrl) {
      throw new Error("No valid English source URL is available for key comparison.");
    }

    console.log(`Loading English source from ${selectedEnUrl} ...`);
    const enJson = await loadEnJson(selectedEnUrl);

    console.log(`Loading zh-TW file from ${ZH_FILE} ...`);
    const zhJson = await loadZhJson(repoRoot);

    console.log("Flattening English keys ...");
    const enFlat = flattenObject(enJson);
    console.log(`Found ${enFlat.length} English leaf entries.`);

    console.log("Flattening zh-TW keys ...");
    const zhFlat = flattenObject(zhJson);
    console.log(`Found ${zhFlat.length} zh-TW leaf entries.`);

    enIndex = buildKeyIndex(enFlat);
    zhIndex = buildKeyIndex(zhFlat);

    const enKeys = new Set(enIndex.keys());
    const zhKeys = new Set(zhIndex.keys());

    for (const key of enKeys) {
      if (!zhKeys.has(key)) missingKeys.push(key);
    }

    for (const key of zhKeys) {
      if (!enKeys.has(key)) obsoleteKeys.push(key);
    }
  }

  const report = generateReport({
    enIndex,
    zhIndex,
    missingKeys,
    obsoleteKeys,
    statusInfo,
    latestVersion,
    lastCheckedVersion,
    comparisonPerformed: shouldCompareKeys,
    selectedSourceId,
    selectedEnUrl,
    zhMTime,
    lastZhMTime
  });

  const reportFullPath = path.join(repoRoot, REPORT_PATH);
  await fs.mkdir(path.dirname(reportFullPath), { recursive: true });
  await fs.writeFile(reportFullPath, report, "utf8");

  const newCache = {
    lastCheckedVersion: latestVersion ?? lastCheckedVersion ?? null,
    lastZhMTime: zhMTime ?? lastZhMTime ?? null,
    sources: Object.fromEntries(
      statusInfo.map((s) => [
        s.id,
        {
          statusUrl: s.statusUrl,
          langUrl: s.langUrl,
          version: s.version
        }
      ])
    )
  };
  await saveVersionCache(repoRoot, newCache);

  console.log(`Translation report written to ${REPORT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

