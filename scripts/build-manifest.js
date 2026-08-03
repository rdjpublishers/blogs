#!/usr/bin/env node
/**
 * build-manifest.js
 *
 * Walks every category folder in the repo, reads each post's meta.json,
 * and writes a single posts-manifest.json at the repo root.
 *
 * Why: the homepage and category pages used to call the GitHub Contents
 * API (unauthenticated) once per category *plus* once per post, on every
 * single page load, for every visitor. That burns through GitHub's 60
 * requests/hour/IP limit almost immediately (shared office/school/mobile
 * IPs make this worse), which is what caused posts to fail to load.
 *
 * This script runs in CI (see .github/workflows/pagefind.yml) so the
 * manifest is always fresh after a publish, and the site reads one static
 * JSON file instead of hammering the GitHub API.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Folders that are never blog categories.
const IGNORE = new Set(['.git', '.github', 'search', 'scripts', 'node_modules']);

function isCategoryDir(name) {
  return !IGNORE.has(name) && !name.startsWith('.');
}

// Safe wrapper: a folder that's mid-upload (e.g. GitHub's web "Add file"
// flow commits files one at a time) can briefly disappear or become
// unreadable between the readdir() that found it and the fs call that
// tries to look inside it. Never let that kill the whole build — skip
// the offending entry and keep going.
function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`⚠️  Skipping unreadable directory ${dir}: ${err.message}`);
    return [];
  }
}

function findCategoryDirs(base, prefix = '') {
  // Supports nested category ids like "Tutorials/HowtoGuides".
  const found = [];
  for (const entry of safeReaddir(base)) {
    if (!entry.isDirectory()) continue;
    if (prefix === '' && !isCategoryDir(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(base, entry.name);
    const children = safeReaddir(full);
    const hasPosts = children.some(c => c.isDirectory() && fs.existsSync(path.join(full, c.name, 'meta.json')));
    const hasSubcats = children.some(c => c.isDirectory() && !fs.existsSync(path.join(full, c.name, 'meta.json')));
    if (hasPosts) found.push(rel);
    if (hasSubcats) found.push(...findCategoryDirs(full, rel));
  }
  return found;
}

function collectPosts() {
  const posts = [];
  const categoryDirs = findCategoryDirs(ROOT);

  for (const catId of categoryDirs) {
    const catPath = path.join(ROOT, catId);
    for (const entry of safeReaddir(catPath)) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(catPath, entry.name, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const raw = fs.readFileSync(metaPath, 'utf8');
        const meta = JSON.parse(raw);
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
          throw new Error('meta.json must contain a JSON object');
        }
        posts.push({ ...meta, category: meta.category || catId, slug: meta.slug || entry.name });
      } catch (err) {
        console.error(`⚠️  Skipping invalid meta.json at ${metaPath}: ${err.message}`);
      }
    }
  }

  // Posts with a missing/unparseable date sort to the end instead of
  // corrupting the whole sort (invalid Date -> NaN, whose ordering vs.
  // other values isn't consistent) or throwing.
  const time = (d) => {
    const t = new Date(d).getTime();
    return Number.isNaN(t) ? -Infinity : t;
  };
  posts.sort((a, b) => time(b.date) - time(a.date));
  return posts;
}

try {
  const posts = collectPosts();
  const outPath = path.join(ROOT, 'posts-manifest.json');
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), posts }, null, 2) + '\n');
  console.log(`✅ Wrote ${posts.length} post(s) to posts-manifest.json`);
} catch (err) {
  // Last-resort safety net. Individual bad posts/dirs are already handled
  // above and won't reach here — this only catches something truly
  // unexpected, and fails loudly rather than committing a half-built
  // manifest.
  console.error(`❌ Failed to build posts-manifest.json: ${err.message}`);
  process.exit(1);
}
