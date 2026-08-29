import axios from "axios";
import { gunzipSync } from "node:zlib";

/**
 * Branch directory backing the "Find IFSC" flow.
 *
 * Cashfree's IFSC API only resolves a code the user already has — it cannot
 * answer "which branches exist in this district". Razorpay publishes an
 * open-source, RBI-sourced branch dataset that can, but only as a release
 * tarball (the per-bank files are not served over raw.githubusercontent).
 *
 * So this module downloads that tarball once, unpacks it in memory, and keeps
 * a per-bank cache. The app never downloads the dataset itself (SBI alone is
 * 12MB of JSON) and nobody has to hand-maintain branch data.
 */

const RELEASE_API =
  "https://api.github.com/repos/razorpay/ifsc/releases/latest";

// The dataset moves roughly monthly, so a day-long cache is plenty fresh.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** bankCode -> { branches: [...], fetchedAt: number } */
const bankCache = new Map();

/** The unpacked tarball, held only while banks are being extracted from it. */
let tarPromise = null;
let tarFetchedAt = 0;

/**
 * Reads a single file out of an uncompressed tar buffer.
 *
 * Implemented directly against the tar header format rather than pulling in a
 * dependency: each entry is a 512-byte header (name at 0, octal size at 124)
 * followed by its content padded to a 512-byte boundary.
 */
function extractFromTar(buf, wanted) {
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const name = buf.toString("utf8", offset, offset + 100).replace(/\0.*$/, "");
    if (!name) break;

    const sizeField = buf
      .toString("utf8", offset + 124, offset + 136)
      .replace(/\0.*$/, "")
      .trim();
    const size = parseInt(sizeField, 8) || 0;
    const contentStart = offset + 512;

    if (name === wanted) {
      return buf.subarray(contentStart, contentStart + size);
    }
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return null;
}

/** Resolves the latest release's by-bank.tar.gz download URL. */
async function resolveTarballUrl() {
  const { data } = await axios.get(RELEASE_API, {
    timeout: 20000,
    headers: { Accept: "application/vnd.github+json" },
  });
  const asset = (data.assets || []).find((a) => a.name === "by-bank.tar.gz");
  if (!asset) {
    throw new Error("by-bank.tar.gz missing from the latest IFSC release");
  }
  return asset.browser_download_url;
}

/**
 * Downloads and gunzips the dataset. Concurrent callers share one download —
 * without this, several cold requests would each pull 11MB.
 */
function loadTarball() {
  const fresh = tarPromise && Date.now() - tarFetchedAt < CACHE_TTL_MS;
  if (fresh) return tarPromise;

  tarFetchedAt = Date.now();
  tarPromise = (async () => {
    const url = await resolveTarballUrl();
    console.log("[ifsc] downloading branch dataset:", url);
    const { data } = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 120000,
      maxContentLength: 64 * 1024 * 1024,
    });
    return gunzipSync(Buffer.from(data));
  })().catch((err) => {
    // Don't cache a failed download — the next request should retry.
    tarPromise = null;
    tarFetchedAt = 0;
    throw err;
  });

  return tarPromise;
}

/**
 * All branches for a bank code (e.g. "HDFC"), normalised to lowercase keys.
 * Returns null when the bank is not in the dataset.
 */
export async function getBranchesForBank(bankCode) {
  const code = String(bankCode).trim().toUpperCase();

  const cached = bankCache.get(code);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.branches;
  }

  const tar = await loadTarball();
  const file = extractFromTar(tar, `by-bank/${code}.json`);
  if (!file) return null;

  const parsed = JSON.parse(file.toString("utf8"));
  const branches = Object.values(parsed).map((b) => ({
    ifsc: b.IFSC,
    bank: b.BANK,
    branch: b.BRANCH,
    address: b.ADDRESS,
    city: b.CITY,
    district: b.DISTRICT,
    state: b.STATE,
    micr: b.MICR,
  }));

  bankCache.set(code, { branches, fetchedAt: Date.now() });
  return branches;
}

/** Distinct, alphabetically sorted states a bank operates in. */
export function statesOf(branches) {
  return [...new Set(branches.map((b) => b.state).filter(Boolean))].sort();
}

/** Distinct, alphabetically sorted districts within one state. */
export function districtsOf(branches, state) {
  const target = String(state).trim().toUpperCase();
  const districts = branches
    .filter((b) => (b.state || "").toUpperCase() === target)
    .map((b) => b.district)
    .filter(Boolean);
  return [...new Set(districts)].sort();
}

/**
 * Branches within a state, optionally narrowed by district and a free-text
 * query matched against branch name, city and address.
 */
export function filterBranches(branches, { state, district, q, limit = 50 }) {
  let rows = branches;

  if (state) {
    const s = String(state).trim().toUpperCase();
    rows = rows.filter((b) => (b.state || "").toUpperCase() === s);
  }
  if (district) {
    const d = String(district).trim().toUpperCase();
    rows = rows.filter((b) => (b.district || "").toUpperCase() === d);
  }
  if (q) {
    const needle = String(q).trim().toLowerCase();
    rows = rows.filter((b) =>
      [b.branch, b.city, b.district, b.address]
        .some((f) => (f || "").toLowerCase().includes(needle))
    );
  }

  const total = rows.length;
  rows = [...rows].sort((a, b) => (a.branch || "").localeCompare(b.branch || ""));
  return { total, branches: rows.slice(0, limit) };
}
