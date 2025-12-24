#!/usr/bin/env node
/**
 * Lab 5-1-dom-api-tasks — Autograder (grade.cjs)
 *
 * Scoring:
 * - TODO 1: 20
 * - TODO 2: 20
 * - TODO 3: 20
 * - TODO 4: 20
 * - Tasks total: 80
 * - Submission: 20 (on-time=20, late=10, missing/empty script.js=0)
 * - Total: 100
 *
 * Due date: NONE (no late penalties)
 *
 * Status codes (unchanged):
 * - 0 = on time
 * - 1 = late
 * - 2 = no submission OR empty JS file
 *
 * Policy for this lab:
 * - No due date → never mark late (status will be 0 if submission exists)
 * - Still enforce status=2 for missing/empty script.js
 *
 * Outputs:
 * - artifacts/grade.csv  (structure unchanged)
 * - artifacts/feedback/README.md
 * - GitHub Actions Step Summary (GITHUB_STEP_SUMMARY)
 *
 * NOTE: In your workflow, make sure checkout uses full history:
 *   uses: actions/checkout@v4
 *   with: { fetch-depth: 0 }
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execSync } = require("child_process");

const LAB_NAME = "5-1-dome-api-tasks";

const ARTIFACTS_DIR = "artifacts";
const FEEDBACK_DIR = path.join(ARTIFACTS_DIR, "feedback");
fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

/** Required submission file */
const REQUIRED_JS_PATH = "script.js";

/** ---------- Student ID ---------- */
function getStudentId() {
  const repoFull = process.env.GITHUB_REPOSITORY || ""; // org/repo
  const repoName = repoFull.includes("/") ? repoFull.split("/")[1] : repoFull;
  const fromRepoSuffix =
    repoName && repoName.includes("-")
      ? repoName.split("-").slice(-1)[0]
      : "";
  return (
    process.env.STUDENT_USERNAME ||
    fromRepoSuffix ||
    process.env.GITHUB_ACTOR ||
    repoName ||
    "student"
  );
}

/** ---------- Git helpers (kept; due date is NONE so no late logic used) ---------- */
function getHeadCommitInfo() {
  try {
    const out = execSync("git log -1 --format=%H|%ct|%an|%ae|%s", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();

    if (!out) return null;

    const [sha, ct, an, ae, ...subjParts] = out.split("|");
    const seconds = Number(ct);
    const epochMs = Number.isFinite(seconds) ? seconds * 1000 : null;

    return {
      sha: sha || "unknown",
      epochMs,
      iso: epochMs ? new Date(epochMs).toISOString() : "unknown",
      author: an || "unknown",
      email: ae || "unknown",
      subject: subjParts.join("|") || "",
    };
  } catch {
    return null;
  }
}

/** ---------- File helpers ---------- */
function readTextSafe(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
function stripJsComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}
function compactWs(s) {
  return s.replace(/\s+/g, " ").trim();
}
function isEmptyCode(code) {
  const stripped = compactWs(stripJsComments(code));
  return stripped.length < 10;
}

/** ---------- VM helpers (best-effort, never crash grading) ---------- */
function canCompileInVm(studentCode) {
  try {
    new vm.Script(`(function(){ ${studentCode} })();`);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: String(e && e.stack ? e.stack : e) };
  }
}
function runInSandbox(studentCode, { postlude = "" } = {}) {
  const logs = [];
  const context = {
    console: {
      log: (...args) => logs.push(args.map((a) => String(a)).join(" ")),
      warn: (...args) => logs.push(args.map((a) => String(a)).join(" ")),
      error: (...args) => logs.push(args.map((a) => String(a)).join(" ")),
    },
    globalThis: {},
    __RUNTIME_ERROR__: null,
  };
  context.globalThis = context;

  const wrapped = `
    (function(){
      "use strict";
      try {
        ${studentCode}
        ${postlude}
      } catch (e) {
        globalThis.__RUNTIME_ERROR__ = (e && e.stack) ? String(e.stack) : String(e);
      }
    })();
  `;

  try {
    const script = new vm.Script(wrapped);
    const ctx = vm.createContext(context);
    script.runInContext(ctx, { timeout: 800 });
  } catch (e) {
    context.__RUNTIME_ERROR__ = String(e && e.stack ? e.stack : e);
  }

  return { logs, runtimeError: context.__RUNTIME_ERROR__ || null };
}

/** ---------- Requirement helpers ---------- */
function req(label, ok, detailIfFail = "") {
  return { label, ok: !!ok, detailIfFail };
}
function formatReqs(reqs) {
  return reqs
    .map((r) =>
      r.ok
        ? `- ✅ ${r.label}`
        : `- ❌ ${r.label}${r.detailIfFail ? ` — ${r.detailIfFail}` : ""}`
    )
    .join("\n");
}
function scoreFromReqs(reqs, maxMarks) {
  const total = reqs.length || 1;
  const ok = reqs.filter((r) => r.ok).length;
  return Math.round((maxMarks * ok) / total);
}

/** ---------- Flexible detectors ---------- */
function hasAny(code, regexes) {
  return regexes.some((re) => re.test(code));
}

// Try to locate code that "targets" an element by id (covers getElementById, querySelector, etc.)
function mentionsId(code, id) {
  const safe = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return hasAny(code, [
    new RegExp(`getElementById\\s*\\(\\s*["'\`]${safe}["'\`]\\s*\\)`, "i"),
    new RegExp(`querySelector\\s*\\(\\s*["'\`]#${safe}["'\`]\\s*\\)`, "i"),
    new RegExp(`querySelectorAll\\s*\\(\\s*["'\`]#${safe}["'\`]\\s*\\)`, "i"),
    new RegExp(`\\bid\\s*===\\s*["'\`]${safe}["'\`]`, "i"),
    new RegExp(`["'\`]${safe}["'\`]`, "i"), // loose fallback
  ]);
}

// Detect event hookup (addEventListener or onclick assignment) for click
function hasClickHandler(code) {
  return hasAny(code, [
    /addEventListener\s*\(\s*["'`]click["'`]/i,
    /\.onclick\s*=/i,
    /onClick\s*=/i,
  ]);
}

// Detect DOM text update methods
function hasTextUpdate(code) {
  return hasAny(code, [
    /\.textContent\s*=/i,
    /\.innerText\s*=/i,
    /\.innerHTML\s*=/i,
    /\.append\s*\(/i,
    /\.insertAdjacentText\s*\(/i,
  ]);
}

// Detect fetch usage (native fetch or axios)
function hasFetchLike(code) {
  return hasAny(code, [
    /\bfetch\s*\(/i,
    /\baxios\s*\.\s*get\s*\(/i,
    /\bXMLHttpRequest\b/i,
  ]);
}

// Detect promise/async handling (then/await)
function hasAsyncHandling(code) {
  return hasAny(code, [/\bawait\b/i, /\.then\s*\(/i, /\basync\b/i]);
}

/** ---------- TODO checks (top-level, flexible) ---------- */
/**
 * TODO 1 is not included in the snippet, but user requested grading 4 TODOs.
 * We'll grade TODO 1 as "general DOM wiring present" to keep it fair + simple:
 * - at least one DOM selection AND at least one event handler AND at least one text update
 */
function checkTodo1(code) {
  const reqs = [];
  const hasDomSelect = hasAny(code, [
    /getElementById\s*\(/i,
    /querySelector(All)?\s*\(/i,
    /document\s*\.\s*getElementsBy/i,
  ]);
  reqs.push(req("Uses DOM selection (getElementById/querySelector/etc.)", hasDomSelect));
  reqs.push(req("Handles a user interaction (click handler)", hasClickHandler(code)));
  reqs.push(req("Updates the page (textContent/innerText/innerHTML/etc.)", hasTextUpdate(code)));
  const earned = scoreFromReqs(reqs, 20);
  return { earned, max: 20, reqs };
}

/** TODO 2: button #t2-btn updates #t2-status text */
function checkTodo2(code) {
  const reqs = [];
  reqs.push(req('References button id "t2-btn"', mentionsId(code, "t2-btn")));
  reqs.push(req("Attaches a click handler", hasClickHandler(code)));
  reqs.push(req('References status id "t2-status"', mentionsId(code, "t2-status")));
  reqs.push(req("Changes the status text (textContent/innerText/innerHTML)", hasTextUpdate(code)));
  // optional: check for message string (case-insensitive, tolerate punctuation/case)
  reqs.push(
    req(
      'Contains expected message (loose match for "clicked")',
      /clicked/i.test(code)
    )
  );

  const earned = scoreFromReqs(reqs, 20);
  return { earned, max: 20, reqs };
}

/** TODO 3: fetch random quote from dummyjson and display quote + author */
function checkTodo3(code) {
  const reqs = [];
  reqs.push(req('References button id "t3-loadQuote"', mentionsId(code, "t3-loadQuote")));
  reqs.push(req("Attaches a click handler", hasClickHandler(code)));
  reqs.push(req("Uses fetch/axios/XHR to call an API", hasFetchLike(code)));
  reqs.push(
    req(
      "Calls the random quote endpoint (dummyjson.com/quotes/random) (loose)",
      /dummyjson\.com\/quotes\/random/i.test(code)
    )
  );
  reqs.push(req("Handles async result (await/then)", hasAsyncHandling(code)));
  reqs.push(req('References quote output id "t3-quote"', mentionsId(code, "t3-quote")));
  reqs.push(req('References author output id "t3-author"', mentionsId(code, "t3-author")));
  // data fields vary across APIs; accept either content/author or quote/author
  reqs.push(
    req(
      "Uses quote text field (content OR quote) and author field",
      hasAny(code, [/\bdata\s*\.\s*content\b/i, /\bdata\s*\.\s*quote\b/i]) &&
        /\bdata\s*\.\s*author\b/i.test(code)
    )
  );
  reqs.push(req("Updates DOM with the fetched values", hasTextUpdate(code)));

  const earned = scoreFromReqs(reqs, 20);
  return { earned, max: 20, reqs };
}

/** TODO 4: fetch weather and display temp/hum/wind */
function checkTodo4(code) {
  const reqs = [];
  reqs.push(req('References button id "t4-loadWx"', mentionsId(code, "t4-loadWx")));
  reqs.push(req("Attaches a click handler", hasClickHandler(code)));
  reqs.push(req("Uses fetch/axios/XHR to call an API", hasFetchLike(code)));

  // allow either OpenWeatherMap or any weather endpoint mentioning Dammam
  reqs.push(
    req(
      "Calls a weather API for Dammam (loose)",
      /Dammam/i.test(code) &&
        hasAny(code, [/openweathermap\.org/i, /api\.openweathermap\.org/i, /weather/i])
    )
  );

  reqs.push(req("Handles async result (await/then)", hasAsyncHandling(code)));
  reqs.push(req('References output id "t4-temp"', mentionsId(code, "t4-temp")));
  reqs.push(req('References output id "t4-hum"', mentionsId(code, "t4-hum")));
  reqs.push(req('References output id "t4-wind"', mentionsId(code, "t4-wind")));

  // accept common OpenWeatherMap fields
  reqs.push(
    req(
      "Reads temperature/humidity/wind from response (typical fields)",
      hasAny(code, [/\bdata\s*\.\s*main\s*\.\s*temp\b/i, /\bmain\s*\.\s*temp\b/i]) &&
        hasAny(code, [/\bdata\s*\.\s*main\s*\.\s*humidity\b/i, /\bmain\s*\.\s*humidity\b/i]) &&
        hasAny(code, [/\bdata\s*\.\s*wind\s*\.\s*speed\b/i, /\bwind\s*\.\s*speed\b/i])
    )
  );

  reqs.push(req("Updates DOM with the fetched values", hasTextUpdate(code)));

  const earned = scoreFromReqs(reqs, 20);
  return { earned, max: 20, reqs };
}

/** ---------- Locate submission ---------- */
const studentId = getStudentId();
const jsPath = REQUIRED_JS_PATH;
const hasJs = fs.existsSync(jsPath) && fs.statSync(jsPath).isFile();
const jsCode = hasJs ? readTextSafe(jsPath) : "";
const jsEmpty = hasJs ? isEmptyCode(jsCode) : true;

const jsNote = hasJs
  ? jsEmpty
    ? `⚠️ Found \`${jsPath}\` but it appears empty (or only comments).`
    : `✅ Found \`${jsPath}\`.`
  : `❌ Required file not found: \`${jsPath}\`.`;

/** ---------- Status & submission marks (policy kept; no due date so never late) ---------- */
let status = 0;
if (!hasJs || jsEmpty) status = 2;
else status = 0; // no due date → always on-time if submitted

const submissionMarks = status === 2 ? 0 : 20;

const headInfo = getHeadCommitInfo();
const submissionStatusText =
  status === 2
    ? "No submission detected (missing/empty script.js): submission marks = 0/20."
    : `Submission detected: 20/20. (HEAD: ${headInfo ? headInfo.sha : "unknown"} @ ${headInfo ? headInfo.iso : "unknown"})`;

/** ---------- Optional compile/run info (non-grading) ---------- */
let compileError = null;
let runGeneral = null;

if (hasJs && !jsEmpty) {
  const cc = canCompileInVm(jsCode);
  if (!cc.ok) compileError = cc.error;
  else runGeneral = runInSandbox(jsCode);
}

/** ---------- Grade TODOs ---------- */
let todo1, todo2, todo3, todo4;

if (status === 2) {
  const r = [req("No submission / empty script.js → cannot grade TODOs", false)];
  todo1 = { earned: 0, max: 20, reqs: r };
  todo2 = { earned: 0, max: 20, reqs: r };
  todo3 = { earned: 0, max: 20, reqs: r };
  todo4 = { earned: 0, max: 20, reqs: r };
} else {
  const cleaned = stripJsComments(jsCode);
  todo1 = checkTodo1(cleaned);
  todo2 = checkTodo2(cleaned);
  todo3 = checkTodo3(cleaned);
  todo4 = checkTodo4(cleaned);
}

const earnedTasks = todo1.earned + todo2.earned + todo3.earned + todo4.earned;
const totalEarned = Math.min(earnedTasks + submissionMarks, 100);

/** ---------- Build Summary ---------- */
const now = new Date().toISOString();

let summary = `# Lab | ${LAB_NAME} | Autograding Summary

- Student: \`${studentId}\`
- ${jsNote}
- ${submissionStatusText}

- Repo HEAD commit:
  - SHA: \`${headInfo ? headInfo.sha : "unknown"}\`
  - Author: \`${headInfo ? headInfo.author : "unknown"}\` <${headInfo ? headInfo.email : "unknown"}>
  - Time (UTC ISO): \`${headInfo ? headInfo.iso : "unknown"}\`

- Status: **${status}** (0=on time, 1=late, 2=no submission/empty)
- Run: \`${now}\`

## Marks Breakdown

| Item | Marks |
|------|------:|
| TODO 1 | ${todo1.earned}/${todo1.max} |
| TODO 2 | ${todo2.earned}/${todo2.max} |
| TODO 3 | ${todo3.earned}/${todo3.max} |
| TODO 4 | ${todo4.earned}/${todo4.max} |
| Submission | ${submissionMarks}/20 |

## Total Marks

**${totalEarned} / 100**

## Detailed Feedback

### TODO 1
${formatReqs(todo1.reqs)}

### TODO 2
${formatReqs(todo2.reqs)}

### TODO 3
${formatReqs(todo3.reqs)}

### TODO 4
${formatReqs(todo4.reqs)}
`;

if (compileError) {
  summary += `\n---\n⚠️ **SyntaxError: code could not compile (best-effort).**\n\n\`\`\`\n${compileError}\n\`\`\`\n`;
} else if (runGeneral && runGeneral.runtimeError) {
  summary += `\n---\n⚠️ **Runtime error detected (best-effort captured):**\n\n\`\`\`\n${runGeneral.runtimeError}\n\`\`\`\n`;
}

/** ---------- Write outputs ---------- */
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

/** DO NOT change CSV structure */
const csv = `student_username,obtained_marks,total_marks,status
${studentId},${totalEarned},100,${status}
`;

fs.writeFileSync(path.join(ARTIFACTS_DIR, "grade.csv"), csv);
fs.writeFileSync(path.join(FEEDBACK_DIR, "README.md"), summary);

console.log(`✔ Lab graded: ${totalEarned}/100 (status=${status})`);
