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

function findCategoryDirs(base, prefix = '') {
  // Supports nested category ids like "Tutorials/HowtoGuides".
  const found = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (prefix === '' && !isCategoryDir(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(base, entry.name);
    const children = fs.readdirSync(full, { withFileTypes: true });
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
    for (const entry of fs.readdirSync(catPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(catPath, entry.name, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const raw = fs.readFileSync(metaPath, 'utf8');
        const meta = JSON.parse(raw);
        posts.push({ ...meta, category: meta.category || catId, slug: meta.slug || entry.name });
      } catch (err) {
        console.error(`⚠️  Skipping invalid meta.json at ${metaPath}: ${err.message}`);
      }
    }
  }

  posts.sort((a, b) => new Date(b.date) - new Date(a.date));
  return posts;
}

const posts = collectPosts();
const outPath = path.join(ROOT, 'posts-manifest.json');
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), posts }, null, 2) + '\n');
console.log(`✅ Wrote ${posts.length} post(s) to posts-manifest.json`);
