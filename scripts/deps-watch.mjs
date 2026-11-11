#!/usr/bin/env node
// Dependency watch: is the locked `next` the newest release on its own
// minor line?
//
// Why this exists: Next.js security releases land on every active line at
// once (16.3.x and the 15.5.x backport) and `npm audit` / Dependabot alerts
// read the global GitHub Advisory DB, which lagged Vercel's in-repo advisory
// by 6+ days in Sep 2026. The release line itself is the reliable signal, so
// this script reads the LOCKFILE (not package.json ranges), asks the registry
// for the newest version on the same major.minor, and exits non-zero when the
// lock is behind. The scheduled workflow that runs it goes red and GitHub
// emails the repo owner; that is the whole alert path.
//
// Second check (added 2026-10-20): the "same minor line" rule has a hole.
// Next's LTS policy patches only the NEWEST minor of each major. On
// 2026-10-14 two Critical RCEs + one High DoS were fixed in 16.4.1 and
// 15.5.28 only; 16.3.8 stayed the newest 16.3.x, so this script said
// "current" for six days while the lock was vulnerable. So we also read
// vercel/next.js's own published advisories (the repo endpoint is current
// the day they publish; the global DB is what lags) and go red when the
// locked version falls inside any high/critical range. Unauthenticated
// calls work (60/h); set GITHUB_TOKEN / GH_TOKEN in CI to avoid the limit.
//
// Usage: node scripts/deps-watch.mjs [--lockfile <path>] [--pkg next]
// Env:   DEPS_WATCH_LOCKFILE, DEPS_WATCH_PKG (same as the flags),
//        DEPS_WATCH_ADVISORY_REPO (default vercel/next.js), GITHUB_TOKEN.
// Exit:  0 current, 1 behind / inside a published advisory range (or more
//        than one locked version), 2 error.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const pkg = flag("--pkg", process.env.DEPS_WATCH_PKG || "next");
const lockfile = resolve(
  flag(
    "--lockfile",
    process.env.DEPS_WATCH_LOCKFILE ||
      (existsSync("pnpm-lock.yaml") ? "pnpm-lock.yaml" : "package-lock.json"),
  ),
);

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const parse = (v) => {
  const m = SEMVER.exec(v);
  if (!m) return null;
  return { raw: v, major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null };
};
const cmp = (a, b) =>
  a.major - b.major || a.minor - b.minor || a.patch - b.patch ||
  // a release outranks any prerelease of the same triple
  (a.pre === null) - (b.pre === null) || String(a.pre).localeCompare(String(b.pre));

function lockedVersions(text, path) {
  const out = new Set();
  if (path.endsWith(".json")) {
    const lock = JSON.parse(text);
    const entry = lock.packages?.[`node_modules/${pkg}`];
    if (entry?.version) out.add(entry.version);
  } else {
    // pnpm-lock v6/v9 `packages:` keys: `  next@15.5.27:` or
    // `  next@15.5.27(react@19.2.7):` (older: `  /next@15.5.27:`).
    const re = new RegExp(`^\\s*'?/?${pkg.replace("/", "\\/")}@([0-9][^:(']*)`);
    for (const line of text.split("\n")) {
      const m = re.exec(line);
      if (m) out.add(m[1]);
    }
  }
  return [...out];
}

function newestOnLine(major, minor) {
  // `<M>.<m>.x` = newest patch on the SAME minor; no prereleases, no minor jump.
  const json = execFileSync("npm", ["view", `${pkg}@${major}.${minor}.x`, "version", "--json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  }).trim();
  if (!json) return null;
  const parsed = JSON.parse(json);
  const list = (Array.isArray(parsed) ? parsed : [parsed]).map(parse).filter(Boolean);
  return list.sort(cmp).at(-1) ?? null;
}

function latestOverall() {
  try {
    const v = execFileSync("npm", ["view", pkg, "version"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    }).trim();
    return parse(v);
  } catch {
    return null;
  }
}

// --- published advisories from the framework's own repo -------------------
const advisoryRepo = process.env.DEPS_WATCH_ADVISORY_REPO || "vercel/next.js";
// Repo advisory ranges are hand-written: "> 16.0.0, <= 16.4.0", ">=16.0 <16.3.3",
// ">=15, >=16", "< 16.3.?" all occur. Tokenize loosely, normalize "16" ->
// 16.0.0, and treat any "?" (or otherwise unparseable bound) as AMBIGUOUS:
// reported, never a failure.
const RANGE_TOKEN = /(>=|<=|>|<|=)\s*v?([0-9][0-9A-Za-z.\-?]*)/g;
const normalize = (v) => {
  if (!v || v.includes("?")) return null;
  const parts = v.replace(/^v/, "").split("-")[0].split(".");
  while (parts.length < 3) parts.push("0");
  return parse(parts.slice(0, 3).join("."));
};

// -> "in" | "out" | "ambiguous"
function rangeStatus(ver, rangeText) {
  const tokens = [...rangeText.matchAll(RANGE_TOKEN)];
  if (tokens.length === 0) return "ambiguous";
  let ambiguous = false;
  for (const [, op, v] of tokens) {
    const bound = normalize(v);
    if (!bound) { ambiguous = true; continue; }
    const c = cmp(ver, bound);
    const inside = op === ">=" ? c >= 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : op === "<" ? c < 0 : c === 0;
    if (!inside) return "out";
  }
  return ambiguous ? "ambiguous" : "in";
}

// patched_versions is "15.5.28 | 16.4.1" or "v16.0.7, v15.5.7, 15.6.0-canary.58".
// Fixed when a patched release on OUR major is <= the locked version.
// "unknown" when no patched entry mentions our major at all (the advisory
// data often omits the backport line; do not fail on that, report it).
function patchStatus(ver, patchedText) {
  const list = String(patchedText ?? "").split(/[|,]/).map((s) => s.trim())
    .filter((s) => s && !/canary|rc|beta|alpha/.test(s)).map(normalize).filter(Boolean);
  const sameMajor = list.filter((p) => p.major === ver.major);
  if (sameMajor.length === 0) return "unknown";
  return sameMajor.some((p) => cmp(ver, p) >= 0) ? "fixed" : "open";
}

async function publishedAdvisories() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = { accept: "application/vnd.github+json", "user-agent": "deps-watch" };
  if (token) headers.authorization = `Bearer ${token}`;
  const url = `https://api.github.com/repos/${advisoryRepo}/security-advisories?state=published&per_page=50`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const list = await res.json();
  return list.flatMap((a) =>
    (a.vulnerabilities ?? [])
      .filter((v) => v.package?.ecosystem === "npm" && v.package?.name === pkg && v.vulnerable_version_range)
      .map((v) => ({
        id: a.ghsa_id,
        severity: a.severity,
        summary: a.summary,
        published: (a.published_at ?? "").slice(0, 10),
        range: v.vulnerable_version_range,
        patched: v.patched_versions,
        url: a.html_url,
      })),
  );
}

// Classify one advisory against the locked version: "hit" (fail), "maybe"
// (report only), or null (clear).
function classify(ver, a) {
  if (!["high", "critical"].includes(a.severity)) return null;
  const r = rangeStatus(ver, a.range);
  if (r === "out") return null;
  const p = patchStatus(ver, a.patched);
  if (p === "fixed") return null;
  if (r === "in" && p === "open") return "hit";
  return "maybe";
}

let text;
try {
  text = readFileSync(lockfile, "utf8");
} catch (e) {
  console.error(`deps-watch: cannot read ${lockfile}: ${e.message}`);
  process.exit(2);
}

const locked = lockedVersions(text, lockfile);
if (locked.length === 0) {
  console.error(`deps-watch: no locked version of ${pkg} found in ${lockfile}`);
  process.exit(2);
}

let behind = false;
for (const raw of locked) {
  const cur = parse(raw);
  if (!cur) {
    console.error(`deps-watch: unparseable locked version "${raw}"`);
    process.exit(2);
  }
  const newest = newestOnLine(cur.major, cur.minor);
  if (!newest) {
    console.error(`deps-watch: registry returned nothing for ${pkg}@${cur.major}.${cur.minor}.x`);
    process.exit(2);
  }
  const ok = cmp(cur, newest) >= 0;
  const releaseUrl = `https://github.com/vercel/next.js/releases/tag/v${newest.raw}`;
  console.log(`${pkg}: locked ${cur.raw} (${lockfile})`);
  console.log(`${pkg}: newest on ${cur.major}.${cur.minor}.x line ${newest.raw}`);
  console.log(`${pkg}: release notes ${releaseUrl}`);
  if (ok) {
    console.log(`${pkg}: OK - lockfile is current on its minor line`);
  } else {
    behind = true;
    console.log(`${pkg}: BEHIND - bump ${cur.raw} -> ${newest.raw} on the same minor line and read ${releaseUrl}`);
  }
  const latest = latestOverall();
  if (latest && (latest.major > cur.major || (latest.major === cur.major && latest.minor > cur.minor))) {
    console.log(`${pkg}: note - newer line ${latest.raw} exists (informational unless an advisory below names it)`);
  }

  // Advisory check: is the locked version inside a published high/critical range?
  let hits = [];
  let advisoryNote = "";
  try {
    const all = await publishedAdvisories();
    const graded = all.map((a) => ({ ...a, verdict: classify(cur, a) }));
    hits = graded.filter((a) => a.verdict === "hit");
    const maybes = graded.filter((a) => a.verdict === "maybe");
    console.log(`${pkg}: ${all.length} published ${advisoryRepo} advisory ranges checked: ${hits.length} high/critical hit(s), ${maybes.length} ambiguous`);
    for (const h of hits) {
      console.log(`${pkg}: VULNERABLE - ${h.id} (${h.severity}, ${h.published}) ${h.summary}`);
      console.log(`${pkg}:   affected ${h.range}; patched ${h.patched}; ${h.url}`);
    }
    for (const m of maybes) {
      console.log(`${pkg}: unclear - ${m.id} (${m.severity}, ${m.published}) range "${m.range}" patched "${m.patched}" does not name the ${cur.major}.x line; read ${m.url}`);
    }
    if (hits.length) {
      behind = true;
      const needsJump = hits.some((h) => patchStatus(cur, h.patched) === "open" && !String(h.patched).split(/[|,]/).map((p) => normalize(p.trim())).filter(Boolean).some((p) => p.major === cur.major && p.minor === cur.minor));
      if (needsJump) console.log(`${pkg}: the fix is on a newer minor line; a same-minor bump will NOT clear it (Next patches only the newest minor of each major)`);
      advisoryNote = hits.map((h) => `[${h.id}](${h.url})`).join(", ");
    }
  } catch (e) {
    console.log(`${pkg}: advisory check skipped (${e.message}); line check still applies`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const status = hits.length ? "**VULNERABLE**" : ok ? "current" : "**BEHIND**";
    const row = `| ${pkg} | ${cur.raw} | ${newest.raw} | ${status} | [v${newest.raw}](${releaseUrl}) ${advisoryNote} |\n`;
    const header = "| package | locked | newest on line | status | release / advisories |\n|---|---|---|---|---|\n";
    const fs = await import("node:fs");
    const path = process.env.GITHUB_STEP_SUMMARY;
    const prior = existsSync(path) ? readFileSync(path, "utf8") : "";
    fs.appendFileSync(path, (prior.includes("| package |") ? "" : header) + row);
  }
}

if (locked.length > 1) {
  console.log(`${pkg}: WARNING - ${locked.length} distinct locked versions: ${locked.join(", ")}`);
  behind = true;
}

process.exit(behind ? 1 : 0);
