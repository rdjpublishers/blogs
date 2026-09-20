/* ══════════════════════════════════════════════════════════════════════════════
 * owner-panel.js
 *
 * RDJ Publishers Blog — Owner-only Panel (loaded as an external script).
 *
 * Design intent:
 *   • Zero privileged HTML/CSS/JS strings appear in the public index.html
 *     when the panel is locked. Search engines and visitors see only the
 *     public site.
 *   • The panel only exists in the DOM after a correct password has been
 *     entered. The login modal itself is also created on-demand.
 *   • Trigger: triple-click the green accent dot in the top bar of every
 *     page. This dot is the ONLY privileged element in the static HTML,
 *     and it is styled to look like a generic accent — its purpose is
 *     invisible to visitors.
 *   • Once unlocked, the unlocked state is persisted in localStorage so a
 *     page refresh keeps the panel open for the owner.
 *   • A clear "Sign Out" button removes the panel, clears the persisted
 *     state, and resets the trigger dot color.
 *
 * Dependencies: relies on a handful of globals from the host page
 *   (getCategories, renderSidebar, renderHomeChips).
 *
 * If the host page does not define getCategories, we fall back to the
 * embedded JSON block <script id="rdj-blog-cats" type="application/json">
 * which is part of the static site (not panel-specific).
 * ══════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────────────────────
   * CONFIG (moved out of index.html so it never ships in the public source
   * unless the admin script is requested — and even then it's hashed, not
   * plaintext).
   * ────────────────────────────────────────────────────────────────────────── */
  const ADMIN_HASH = '26f5f8b67b8a8cf17b2a2e43dc2dea57bfdd1cf27175260280308e356ea8e99d'; // same hash as main site
  const STORAGE_KEY = 'rdj_admin_unlocked'; // localStorage flag — owner-only session
  const TRIGGER_CLICKS = 3;                  // triple-click
  const TRIGGER_WINDOW_MS = 600;             // within 600 ms

  /* ──────────────────────────────────────────────────────────────────────────
   * STATE
   * ────────────────────────────────────────────────────────────────────────── */
  let isAdmin = false;
  let dotClickCount = 0;
  let dotClickTimer = null;
  let _catsDraft = null;
  let pendingHtmlContent  = null;
  let pendingHtmlFilename = null;
  let pendingImgFiles     = [];
  let toastTimer = null;

  // Host-page globals (lazy references — resolved on first use so the order
  // of script tags doesn't matter as long as both end up loaded).
  function host() {
    return {
      GH_OWNER: typeof window.GH_OWNER !== 'undefined' ? window.GH_OWNER : 'rdjpublishers',
      GH_REPO : typeof window.GH_REPO  !== 'undefined' ? window.GH_REPO  : 'blogs',
      GH_API  : typeof window.GH_API   !== 'undefined' ? window.GH_API   : `https://api.github.com/repos/rdjpublishers/blogs/contents/`,
      getCategories: typeof window.getCategories === 'function' ? window.getCategories : null,
      renderSidebar: typeof window.renderSidebar === 'function' ? window.renderSidebar : null,
      renderHomeChips: typeof window.renderHomeChips === 'function' ? window.renderHomeChips : null,
    };
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * SHADOW CSS — admin-specific styles, injected into <head> only after the
   * panel is unlocked (or right before opening the login modal so it has
   * correct visuals). Never present in the static HTML.
   * ────────────────────────────────────────────────────────────────────────── */
  const ADMIN_CSS = `
/* ── ADMIN (injected by scripts/admin-panel.js) ── */
.admin-modal-wrap{position:fixed;inset:0;z-index:500;background:rgba(5,20,18,.8);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;padding:1rem;overflow-y:auto;}
.admin-modal-wrap.show{display:flex;}
.admin-modal{background:#fff;border-radius:20px;width:100%;max-width:560px;box-shadow:0 16px 50px rgba(11,110,97,.18);overflow:hidden;max-height:94vh;display:flex;flex-direction:column;margin:auto;}
.admin-modal-head{background:linear-gradient(135deg,#0f1e1c 0%,#1d3632 100%);padding:1.3rem 1.5rem;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.admin-modal-head h2{font-family:'DM Serif Display',Georgia,serif;font-size:1.1rem;color:#fff;}
.admin-modal-head small{font-size:.63rem;color:rgba(255,255,255,0.35);display:block;margin-top:1px;}
.admin-close-btn{background:rgba(255,255,255,0.08);border:none;color:rgba(255,255,255,0.7);width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:.9rem;display:flex;align-items:center;justify-content:center;transition:all .2s;}
.admin-close-btn:hover{background:rgba(255,255,255,0.18);color:#fff;}
.admin-body{padding:1.4rem;overflow-y:auto;flex:1;}
.admin-tabs{display:flex;gap:.25rem;padding:.8rem 1.4rem;border-bottom:1px solid #dde8e6;flex-shrink:0;overflow-x:auto;}
.admin-tab{padding:.45rem .9rem;border-radius:8px;font-family:'DM Sans',system-ui,sans-serif;font-size:.78rem;font-weight:600;border:none;background:transparent;color:#6b8c88;cursor:pointer;white-space:nowrap;transition:all .2s;}
.admin-tab.active{background:#0b6e61;color:#fff;}
.admin-lock-icon{font-size:2.5rem;text-align:center;margin-bottom:.6rem;}
.admin-body h3{font-family:'DM Serif Display',Georgia,serif;font-size:1.1rem;text-align:center;color:#0f1e1c;margin-bottom:.3rem;}
.admin-body p.hint{font-size:.78rem;text-align:center;color:#6b8c88;margin-bottom:1.3rem;}
.admin-input{width:100%;padding:.75rem 1rem;border:2px solid #dde8e6;border-radius:10px;font-family:'DM Sans',system-ui,sans-serif;font-size:.88rem;color:#0f1e1c;outline:none;transition:border-color .2s;margin-bottom:.8rem;background:#f5f7f7;}
.admin-input:focus{border-color:#0b6e61;background:#fff;}
.admin-btn{width:100%;background:#0b6e61;color:#fff;border:none;padding:.85rem;border-radius:10px;font-family:'DM Sans',system-ui,sans-serif;font-size:.9rem;font-weight:700;cursor:pointer;transition:all .2s;}
.admin-btn:hover{background:#084d44;}
.admin-err{color:#dc2626;font-size:.8rem;text-align:center;margin-top:.4rem;display:block;}
.admin-fg{display:flex;flex-direction:column;gap:.3rem;margin-bottom:.85rem;}
.admin-fg label{font-size:.65rem;font-weight:700;color:#0b6e61;text-transform:uppercase;letter-spacing:.08em;}
.admin-fg input,.admin-fg textarea,.admin-fg select{padding:.7rem .9rem;border:1.5px solid #dde8e6;border-radius:9px;background:#f5f7f7;font-family:'DM Sans',system-ui,sans-serif;font-size:.86rem;color:#0f1e1c;outline:none;transition:border-color .2s;}
.admin-fg input:focus,.admin-fg textarea:focus,.admin-fg select:focus{border-color:#0b6e61;background:#fff;}
.admin-fg textarea{resize:vertical;min-height:80px;}
.admin-row{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;}
@media(max-width:420px){.admin-row{grid-template-columns:1fr;}}
.admin-fg.full{grid-column:1/-1;}
.char-count{font-size:.63rem;color:#6b8c88;text-align:right;margin-top:2px;}
.char-count.warn{color:#f59e0b;}
.char-count.over{color:#dc2626;}
.admin-actions{display:flex;gap:.7rem;padding-top:.9rem;border-top:1px solid #dde8e6;margin-top:.9rem;}
.btn-save{flex:1;background:#0b6e61;color:#fff;border:none;padding:.75rem;border-radius:9px;font-family:'DM Sans',system-ui,sans-serif;font-size:.85rem;font-weight:700;cursor:pointer;transition:all .2s;}
.btn-save:hover{background:#084d44;}
.btn-save:disabled{opacity:.5;cursor:not-allowed;}
.btn-cancel{background:#f5f7f7;color:#6b8c88;border:1.5px solid #dde8e6;padding:.75rem 1.1rem;border-radius:9px;font-family:'DM Sans',system-ui,sans-serif;font-size:.85rem;font-weight:600;cursor:pointer;transition:all .2s;}
.btn-cancel:hover{background:#dde8e6;}
.file-drop{border:2px dashed #dde8e6;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;transition:all .2s;background:#f5f7f7;}
.file-drop:hover,.file-drop.drag{border-color:#0b6e61;background:#e6f4f2;}
.file-drop p{font-size:.82rem;color:#6b8c88;margin-top:.4rem;}
.file-drop .fd-icon{font-size:1.8rem;}
.file-status{margin-top:.6rem;font-size:.8rem;color:#0b6e61;font-weight:600;}
.validation-list{list-style:none;margin-top:.4rem;}
.validation-list li{font-size:.75rem;padding:.15rem 0;display:flex;align-items:center;gap:.4rem;}
.validation-list li.ok{color:#16a34a;}
.validation-list li.err{color:#dc2626;}
.publish-box{background:#f5f7f7;border-radius:12px;padding:1.2rem;border:1.5px solid #dde8e6;margin-top:.8rem;}
.publish-box h4{font-family:'DM Serif Display',Georgia,serif;font-size:.95rem;color:#0f1e1c;margin-bottom:.7rem;}
.publish-log{background:#0f1e1c;border-radius:8px;padding:.85rem;margin-top:.6rem;font-size:.73rem;color:rgba(255,255,255,0.55);font-family:monospace;line-height:1.8;max-height:140px;overflow-y:auto;display:none;}
.publish-log.show{display:block;}
.publish-log .log-ok{color:#4ade80;}
.publish-log .log-err{color:#f87171;}
.publish-log .log-info{color:rgba(255,255,255,0.55);}
.export-box{background:#e6f4f2;border:1.5px solid #0b6e61;border-radius:12px;padding:1.2rem;font-size:.82rem;color:#084d44;line-height:1.7;}
.export-box strong{display:block;margin-bottom:.4rem;font-size:.88rem;}
.export-box code{background:rgba(0,0,0,0.07);padding:.1rem .4rem;border-radius:4px;font-size:.78rem;}
`;

  let cssInjected = false;
  function injectCss() {
    if (cssInjected) return;
    const s = document.createElement('style');
    s.id = 'rdj-admin-css';
    s.appendChild(document.createTextNode(ADMIN_CSS));
    document.head.appendChild(s);
    cssInjected = true;
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * HTML TEMPLATES — never present in the public HTML. Created on demand.
   * ────────────────────────────────────────────────────────────────────────── */
  const LOGIN_HTML = `
<div class="admin-modal-wrap" id="adminLoginWrap">
  <div class="admin-modal" style="max-width:380px;">
    <div class="admin-modal-head">
      <div><h2>Admin Login</h2><small>Blog Publisher — rdjpublishers.com/blogs/</small></div>
      <button class="admin-close-btn" type="button" data-action="close-login" aria-label="Close">✕</button>
    </div>
    <div class="admin-body">
      <div class="admin-lock-icon">🔐</div>
      <h3>Admin Access</h3>
      <p class="hint">Enter your password to publish posts to the blog.</p>
      <input class="admin-input" type="password" id="adminPass" placeholder="Admin password" autocomplete="current-password">
      <button class="admin-btn" type="button" data-action="login">Sign In →</button>
      <span class="admin-err" id="adminErr"></span>
    </div>
  </div>
</div>`;

  const PANEL_HTML = `
<div class="admin-modal-wrap" id="adminPanelWrap">
  <div class="admin-modal">
    <div class="admin-modal-head">
      <div><h2>Blog Admin Panel</h2><small>Publish posts to rdjpublishers.com/blogs/</small></div>
      <div style="display:flex;align-items:center;gap:.5rem;">
        <button class="admin-close-btn" type="button" data-action="signout" title="Sign out" aria-label="Sign out" style="background:rgba(220,38,38,0.18);color:#fca5a5;">🚪</button>
        <button class="admin-close-btn" type="button" data-action="close-panel" aria-label="Close">✕</button>
      </div>
    </div>
    <div class="admin-tabs">
      <button class="admin-tab active" type="button" data-tab="publish">📝 New Post</button>
      <button class="admin-tab" type="button" data-tab="cats">📂 Categories</button>
      <button class="admin-tab" type="button" data-tab="info">ℹ️ Setup</button>
    </div>
    <div class="admin-body">

      <!-- ── NEW POST TAB ── -->
      <div id="tab-publish">
        <div class="admin-fg">
          <label>Category *</label>
          <select id="f-cat"></select>
        </div>
        <div class="admin-fg">
          <label>Post Title * <span style="font-weight:400;text-transform:none;letter-spacing:0;">(max 100 chars)</span></label>
          <input type="text" id="f-title" placeholder="e.g. Google SEO Complete Guide 2026" maxlength="100">
          <div class="char-count" id="title-count">0 / 100</div>
        </div>
        <div class="admin-fg">
          <label>URL Slug * <span style="font-weight:400;text-transform:none;letter-spacing:0;">(auto-generated)</span></label>
          <input type="text" id="f-slug" placeholder="google-seo-complete-guide-2026" maxlength="60">
          <div class="char-count" id="slug-count">0 / 60</div>
        </div>
        <div class="admin-fg">
          <label>Meta Description * <span style="font-weight:400;text-transform:none;letter-spacing:0;">(max 160 chars)</span></label>
          <textarea id="f-desc" placeholder="SEO meta description shown in Google…" maxlength="160" rows="3"></textarea>
          <div class="char-count" id="desc-count">0 / 160</div>
        </div>
        <div class="admin-fg">
          <label>Tags <span style="font-weight:400;text-transform:none;letter-spacing:0;">(comma separated)</span></label>
          <input type="text" id="f-tags" placeholder="SEO, Google, 2026">
        </div>
        <div class="admin-fg">
          <label>Cover Image Filename</label>
          <input type="text" id="f-cover" placeholder="cover.jpg" value="cover.jpg">
        </div>
        <div class="admin-fg">
          <label>Post HTML File * <span style="font-weight:400;text-transform:none;letter-spacing:0;">(must contain &lt;html&gt;)</span></label>
          <div class="file-drop" id="html-drop">
            <div class="fd-icon">📄</div>
            <strong style="font-size:.85rem;color:#0f1e1c;">Click to choose HTML file</strong>
            <p>or drag &amp; drop your post's index.html here</p>
            <input type="file" id="html-file-input" accept=".html,.htm" style="display:none">
          </div>
          <div class="file-status" id="html-file-status"></div>
          <ul class="validation-list" id="validation-list"></ul>
        </div>
        <div class="admin-fg">
          <label>Additional Image Files <span style="font-weight:400;text-transform:none;letter-spacing:0;">(cover.jpg etc.)</span></label>
          <input type="file" id="img-files-input" accept="image/*" multiple style="padding:.6rem .9rem;border:1.5px solid #dde8e6;border-radius:9px;background:#f5f7f7;font-family:'DM Sans',system-ui,sans-serif;font-size:.82rem;cursor:pointer;">
          <div class="file-status" id="img-files-status"></div>
        </div>
        <div class="admin-fg">
          <label>GitHub Token *</label>
          <input class="admin-input" type="password" id="gh-token" placeholder="ghp_…" style="margin-bottom:0;">
        </div>
        <div class="admin-actions">
          <button class="btn-save" id="publish-btn" type="button">🚀 Publish Post</button>
        </div>
        <div class="publish-box" id="publish-box" style="display:none;">
          <h4>Publish Log</h4>
          <div class="publish-log show" id="publish-log"></div>
        </div>
      </div>

      <!-- ── CATEGORIES TAB ── -->
      <div id="tab-cats" style="display:none;">
        <div id="cat-local-dirty-banner" style="display:none;background:#fef2f2;border:1.5px solid #fca5a5;color:#991b1b;font-size:.78rem;font-weight:600;border-radius:9px;padding:.6rem .8rem;margin-bottom:.7rem;">
          ✏️ You have unsaved changes. Click "Save Changes Locally" below or they'll be lost if you leave this tab.
        </div>
        <div id="cat-dirty-banner" style="display:none;background:#fdf4e3;border:1.5px solid #c8892a;color:#7a5514;font-size:.78rem;font-weight:600;border-radius:9px;padding:.6rem .8rem;margin-bottom:1rem;">
          ⚠️ Saved locally but not on the live site yet. They'll sync to GitHub automatically the next time you publish a post.
        </div>
        <div id="admin-cat-list" style="margin-bottom:.8rem;"></div>
        <div class="admin-actions" style="margin-bottom:1.2rem;">
          <button class="btn-save" id="cat-save-local-btn" type="button">💾 Save Changes Locally</button>
        </div>
        <div style="background:#f5f7f7;border-radius:10px;padding:1.1rem;border:1.5px solid #dde8e6;">
          <div style="font-size:.7rem;font-weight:700;color:#0b6e61;text-transform:uppercase;letter-spacing:.07em;margin-bottom:.8rem;">➕ Add New Category</div>
          <div class="admin-row">
            <div class="admin-fg">
              <label>Category Name <span style="font-weight:400;text-transform:none;letter-spacing:0;">(PascalCase)</span></label>
              <input type="text" id="nc-name" placeholder="Tech">
            </div>
            <div class="admin-fg">
              <label>Icon / Emoji</label>
              <input type="text" id="nc-icon" placeholder="💻" maxlength="8">
            </div>
          </div>
          <div class="admin-fg">
            <label>Description</label>
            <input type="text" id="nc-desc" placeholder="Technology guides and tutorials">
          </div>
          <div class="admin-actions" style="margin-top:.5rem;">
            <button class="btn-save" type="button" data-action="add-category">➕ Add Category</button>
          </div>
        </div>
        <div style="background:#f5f7f7;border-radius:10px;padding:1.1rem;border:1.5px solid #dde8e6;margin-top:1rem;">
          <div style="font-size:.7rem;font-weight:700;color:#0b6e61;text-transform:uppercase;letter-spacing:.07em;margin-bottom:.5rem;">🚀 Going Live</div>
          <div style="font-size:.75rem;color:#6b8c88;">
            Categories saved locally are automatically pushed to GitHub the next time you publish a post — no separate token needed here.
          </div>
        </div>
      </div>

      <!-- ── SETUP INFO TAB ── -->
      <div id="tab-info" style="display:none;">
        <div class="export-box">
          <strong>📦 Pagefind Search Setup</strong>
          After pushing posts, run this once from your repo root to build the search index:<br>
          <code>npm install pagefind --save-dev</code><br>
          <code>npx pagefind --site . --output-subdir search</code><br><br>
          Then commit and push the generated <code>search/</code> folder.
        </div>
        <div class="export-box" style="margin-top:.8rem;">
          <strong>🌐 Repo &amp; URL Structure</strong>
          Repo: <code>rdjpublishers/blogs</code> → hosted at <code>rdjpublishers.com/blogs/</code><br>
          Post URL: <code>/blogs/Tech/google-seo/</code> → file: <code>Tech/google-seo/index.html</code><br>
          Category URL: <code>/blogs/Tech/</code> → file: <code>Tech/index.html</code><br>
          GitHub Pages auto-serves <code>index.html</code> in any folder.
        </div>
        <div class="export-box" style="margin-top:.8rem;">
          <strong>✅ New Posts Live In</strong>
          GitHub Pages CDN cache = ~10 min. After publishing, wait 5–10 min for new posts to appear.
        </div>
        <div class="export-box" style="margin-top:.8rem;">
          <strong>🗺️ Sitemap</strong>
          <code>sitemap_blogs.xml</code> is auto-regenerated after every publish, structured by category with all post URLs.<br><br>
          <div class="admin-fg" style="margin-bottom:.5rem;">
            <label>GitHub Token</label>
            <input class="admin-input" type="password" id="sm-token" placeholder="ghp_…" style="margin-bottom:0;">
          </div>
          <button class="btn-save" type="button" data-action="regen-sitemap">🔄 Regenerate Sitemap Now</button>
        </div>
        <div class="admin-actions">
          <button class="btn-cancel" type="button" data-action="signout" title="Remove admin panel from this browser">🚪 Sign Out</button>
        </div>
      </div>

    </div>
  </div>
</div>`;

  /* ──────────────────────────────────────────────────────────────────────────
   * INJECTION HELPERS
   * ────────────────────────────────────────────────────────────────────────── */
  function injectLogin() {
    injectCss();
    if (document.getElementById('adminLoginWrap')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = LOGIN_HTML.trim();
    document.body.appendChild(wrap.firstChild);
    wireLoginEvents();
  }
  function injectPanel() {
    injectCss();
    if (document.getElementById('adminPanelWrap')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = PANEL_HTML.trim();
    document.body.appendChild(wrap.firstChild);
    wirePanelEvents();
  }
  function removeLogin() {
    const el = document.getElementById('adminLoginWrap');
    if (el) el.remove();
  }
  function removePanel() {
    const el = document.getElementById('adminPanelWrap');
    if (el) el.remove();
    // Drop any in-progress form state so a re-login starts clean.
    pendingHtmlContent = null;
    pendingHtmlFilename = null;
    pendingImgFiles = [];
    _catsDraft = null;
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * TRIGGER WIRING
   * The host page keeps a single neutral element per topbar. We attach a
   * triple-click handler to every element with the [data-owner-entry]
   * attribute. The static markup uses class="site-trigger-dot" and an
   * aria-label so the element is invisible to crawlers looking for "admin"
   * keywords.
   * ────────────────────────────────────────────────────────────────────────── */
  function wireTriggers() {
    document.querySelectorAll('[data-owner-entry]').forEach((el) => {
      if (el.__adminWired) return;
      el.__adminWired = true;
      el.addEventListener('click', onTriggerClick);
    });
  }
  function onTriggerClick() {
    dotClickCount++;
    clearTimeout(dotClickTimer);
    if (dotClickCount >= TRIGGER_CLICKS) {
      dotClickCount = 0;
      if (isAdmin) openAdminPanel(); else openAdminLogin();
    } else {
      dotClickTimer = setTimeout(() => { dotClickCount = 0; }, TRIGGER_WINDOW_MS);
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * AUTH
   * ────────────────────────────────────────────────────────────────────────── */
  async function checkPassword(input) {
    const enc = new TextEncoder().encode(input);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function openAdminLogin() {
    injectLogin();
    const w = document.getElementById('adminLoginWrap');
    if (w) {
      w.classList.add('show');
      setTimeout(() => document.getElementById('adminPass')?.focus(), 100);
    }
  }
  function closeAdminLogin() {
    const w = document.getElementById('adminLoginWrap');
    if (w) w.classList.remove('show');
  }
  async function doLogin() {
    const pw = document.getElementById('adminPass')?.value || '';
    const hash = await checkPassword(pw);
    if (hash === ADMIN_HASH) {
      isAdmin = true;
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) {}
      closeAdminLogin();
      removeLogin();
      paintDots(true);
      showToast('✅ Admin mode on');
      openAdminPanel();
    } else {
      const el = document.getElementById('adminErr');
      if (el) el.textContent = 'Incorrect password. Try again.';
      const pwEl = document.getElementById('adminPass');
      if (pwEl) { pwEl.value = ''; pwEl.focus(); }
    }
  }
  function wireLoginEvents() {
    const wrap = document.getElementById('adminLoginWrap');
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      const act = t.getAttribute('data-action');
      if (act === 'close-login') closeAdminLogin();
      if (act === 'login') doLogin();
    });
    const passInput = document.getElementById('adminPass');
    if (passInput) {
      passInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doLogin();
      });
    }
    // Click on backdrop (outside the modal box) closes the login.
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) closeAdminLogin();
    });
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * SIGN OUT / LOG OUT
   * ────────────────────────────────────────────────────────────────────────── */
  function signOut() {
    isAdmin = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    closeAdminPanel();
    removePanel();
    paintDots(false);
    showToast('👋 Signed out');
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * PANEL
   * ────────────────────────────────────────────────────────────────────────── */
  function openAdminPanel() {
    if (!isAdmin) return;
    injectPanel();
    renderCatSelect();
    const w = document.getElementById('adminPanelWrap');
    if (w) w.classList.add('show');
  }
  function closeAdminPanel() {
    const w = document.getElementById('adminPanelWrap');
    if (w) w.classList.remove('show');
  }
  function switchTab(tab) {
    ['publish', 'cats', 'info'].forEach((t) => {
      const el = document.getElementById('tab-' + t);
      if (el) el.style.display = (t === tab) ? 'block' : 'none';
    });
    document.querySelectorAll('.admin-tab').forEach((btn, i) => {
      btn.classList.toggle('active', ['publish', 'cats', 'info'][i] === tab);
    });
    if (tab === 'cats') renderAdminCats();
  }
  function wirePanelEvents() {
    const wrap = document.getElementById('adminPanelWrap');
    if (!wrap) return;

    // Header actions (close, sign-out)
    wrap.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (t) {
        const act = t.getAttribute('data-action');
        if (act === 'close-panel') closeAdminPanel();
        if (act === 'signout') signOut();
        if (act === 'add-category') addCategory();
        if (act === 'regen-sitemap') regenerateSitemap();
        return;
      }
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        switchTab(tab.getAttribute('data-tab'));
        return;
      }
      if (e.target === wrap) closeAdminPanel(); // backdrop click
    });

    // Form bindings
    const bind = (id, evt, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(evt, fn);
    };
    bind('f-title', 'input', onTitleInput);
    bind('f-slug',  'input', onSlugInput);
    bind('f-desc',  'input', onDescInput);
    bind('f-cat',   'change', updateSlugPrefix);

    bind('publish-btn', 'click', publishPost);
    bind('cat-save-local-btn', 'click', saveCategoriesLocally);

    const drop = document.getElementById('html-drop');
    if (drop) {
      drop.addEventListener('click', () => document.getElementById('html-file-input')?.click());
      drop.addEventListener('dragover', onDragOver);
      drop.addEventListener('drop', onDrop);
    }
    bind('html-file-input', 'change', onHtmlFileChange);
    bind('img-files-input', 'change', (e) => {
      pendingImgFiles = Array.from(e.target.files);
      const s = document.getElementById('img-files-status');
      if (s) s.textContent = `✅ ${pendingImgFiles.length} image file(s) selected`;
    });

    // Category delete buttons (delegated)
    const list = document.getElementById('admin-cat-list');
    if (list) {
      list.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-delete-cat]');
        if (btn) deleteCategory(btn.getAttribute('data-delete-cat'));
      });
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * DOT COLOR — green when unlocked, default (site accent) when locked.
   * The static element uses class "site-trigger-dot" — we toggle a class
   * rather than set inline styles so the CSS lives in the host stylesheet.
   * ────────────────────────────────────────────────────────────────────────── */
  function paintDots(unlocked) {
    document.querySelectorAll('[data-owner-entry]').forEach((d) => {
      d.classList.toggle('on', !!unlocked);
    });
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * TOAST — local copy (we don't rely on the host page's showToast).
   * Creates its own #toast element if missing.
   * ────────────────────────────────────────────────────────────────────────── */
  function showToast(msg) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      // Re-use the host's toast styles if they exist (#toast is defined in
      // index.html). If the host page ever removed it, fall back to inline
      // minimal styling so the message is still visible.
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f1e1c;color:#fff;padding:.7rem 1.2rem;border-radius:10px;font-family:system-ui;font-size:.85rem;z-index:9999;opacity:0;transition:opacity .25s;box-shadow:0 6px 28px rgba(11,110,97,.18);pointer-events:none;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.style.opacity = '0';
      t.classList.remove('show');
    }, 3000);
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * CATEGORIES — admin-side helpers (getCategories stays on the host page so
   * the public site can render chips/sidebar without loading admin code).
   * ────────────────────────────────────────────────────────────────────────── */
  function getCategories() {
    // Prefer host's getCategories; fall back to localStorage / embedded JSON.
    const h = host();
    if (h.getCategories) return h.getCategories();
    try {
      const s = localStorage.getItem('rdj_blog_cats');
      if (s !== null) {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    try {
      const embedded = document.getElementById('rdj-blog-cats');
      if (embedded) return JSON.parse(embedded.textContent);
    } catch (e) {}
    return [
      { id: 'Tech',      name: 'Tech',         icon: '💻', desc: 'Technology guides, browser tools, coding tips and more.' },
      { id: 'SEO',       name: 'SEO',          icon: '🔍', desc: 'Search engine optimisation strategies and keyword research.' },
      { id: 'Productivity', name: 'Productivity', icon: '⚡', desc: 'Work smarter with productivity tips and workflows.' },
      { id: 'AITools',   name: 'AI Tools',     icon: '🤖', desc: 'Guides to the best AI tools and how to use them.' }
    ];
  }
  function saveCategories(cats) {
    localStorage.setItem('rdj_blog_cats', JSON.stringify(cats));
    localStorage.setItem('rdj_blog_cats_dirty', '1');
  }
  function getCatsDraft() {
    if (_catsDraft === null) _catsDraft = getCategories().slice();
    return _catsDraft;
  }
  function isDraftDirty() {
    if (_catsDraft === null) return false;
    return JSON.stringify(_catsDraft) !== JSON.stringify(getCategories());
  }
  function renderCatSelect() {
    const sel = document.getElementById('f-cat');
    if (!sel) return;
    const cats = getCategories();
    sel.innerHTML = cats.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
  }
  function renderAdminCats() {
    const cats = getCatsDraft();
    const localBanner = document.getElementById('cat-local-dirty-banner');
    if (localBanner) localBanner.style.display = isDraftDirty() ? 'block' : 'none';
    const ghBanner = document.getElementById('cat-dirty-banner');
    if (ghBanner) ghBanner.style.display = (localStorage.getItem('rdj_blog_cats_dirty') === '1') ? 'block' : 'none';
    const el = document.getElementById('admin-cat-list');
    if (!el) return;
    el.innerHTML = cats.length
      ? cats.map(c =>
          `<div style="display:flex;align-items:center;gap:.8rem;padding:.6rem .8rem;background:#fff;border-radius:9px;border:1.5px solid #dde8e6;margin-bottom:.5rem;">
             <span style="font-size:1.1rem;">${c.icon}</span>
             <div style="flex:1;"><div style="font-size:.88rem;font-weight:700;">${c.name}</div><div style="font-size:.7rem;color:#6b8c88;">${c.desc}</div></div>
             <button type="button" data-delete-cat="${c.id}" style="background:#fef2f2;border:none;color:#dc2626;padding:.3rem .6rem;border-radius:6px;cursor:pointer;font-size:.75rem;">🗑️</button>
           </div>`
        ).join('')
      : '<div style="color:#6b8c88;font-size:.83rem;text-align:center;padding:1rem;">No categories yet.</div>';
  }
  function addCategory() {
    const name = (document.getElementById('nc-name')?.value || '').trim();
    const icon = (document.getElementById('nc-icon')?.value || '').trim() || '📁';
    const desc = (document.getElementById('nc-desc')?.value || '').trim();
    if (!name) { showToast('⚠️ Category name required'); return; }
    const id = name.replace(/\s+/g, '');
    const cats = getCatsDraft();
    if (cats.find(c => c.id === id)) { showToast('⚠️ Category already exists'); return; }
    cats.push({ id, name, icon, desc });
    renderAdminCats();
    document.getElementById('nc-name').value = '';
    document.getElementById('nc-icon').value = '';
    document.getElementById('nc-desc').value = '';
    showToast(`✅ "${name}" staged — click "Save Changes Locally" to keep it`);
  }
  function deleteCategory(id) {
    if (!confirm(`Delete category "${id}"?`)) return;
    _catsDraft = getCatsDraft().filter(c => c.id !== id);
    renderAdminCats();
    showToast('🗑️ Staged for deletion — click "Save Changes Locally" to confirm');
  }
  function saveCategoriesLocally() {
    saveCategories(getCatsDraft());
    renderAdminCats();
    renderCatSelect();
    const h = host();
    if (h.renderSidebar) h.renderSidebar();
    if (h.renderHomeChips) h.renderHomeChips();
    showToast('💾 Categories saved locally');
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * SLUG HELPERS
   * ────────────────────────────────────────────────────────────────────────── */
  function slugify(str) {
    return str.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 60)
      .replace(/^-|-$/g, '');
  }
  function onTitleInput() {
    const v = document.getElementById('f-title')?.value || '';
    const cc = document.getElementById('title-count');
    if (cc) { cc.textContent = `${v.length} / 100`; cc.className = 'char-count' + (v.length > 80 ? ' warn' : '') + (v.length >= 100 ? ' over' : ''); }
    const slugEl = document.getElementById('f-slug');
    if (slugEl && !slugEl.dataset.manual) {
      slugEl.value = slugify(v);
      updateSlugCount();
    }
  }
  function onSlugInput() {
    const el = document.getElementById('f-slug');
    if (el) {
      el.dataset.manual = '1';
      el.value = el.value.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
      updateSlugCount();
    }
  }
  function updateSlugCount() {
    const v = document.getElementById('f-slug')?.value || '';
    const cc = document.getElementById('slug-count');
    if (cc) { cc.textContent = `${v.length} / 60`; cc.className = 'char-count' + (v.length > 50 ? ' warn' : '') + (v.length >= 60 ? ' over' : ''); }
  }
  function onDescInput() {
    const v = document.getElementById('f-desc')?.value || '';
    const cc = document.getElementById('desc-count');
    if (cc) { cc.textContent = `${v.length} / 160`; cc.className = 'char-count' + (v.length > 140 ? ' warn' : '') + (v.length >= 160 ? ' over' : ''); }
  }
  function updateSlugPrefix() { /* reserved */ }

  /* ──────────────────────────────────────────────────────────────────────────
   * FILE UPLOAD + VALIDATION
   * ────────────────────────────────────────────────────────────────────────── */
  function onDragOver(e) { e.preventDefault(); document.getElementById('html-drop')?.classList.add('drag'); }
  function onDrop(e) {
    e.preventDefault();
    document.getElementById('html-drop')?.classList.remove('drag');
    const file = e.dataTransfer.files[0];
    if (file) processHtmlFile(file);
  }
  function onHtmlFileChange(e) {
    const file = e.target.files[0];
    if (file) processHtmlFile(file);
  }
  function processHtmlFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target.result;
      pendingHtmlContent = content;
      pendingHtmlFilename = file.name;
      const statusEl = document.getElementById('html-file-status');
      if (statusEl) statusEl.textContent = `✅ ${file.name} loaded (${(file.size / 1024).toFixed(1)} KB)`;
      validateHtml(content);
    };
    reader.readAsText(file);
  }
  function validateHtml(content) {
    const ul = document.getElementById('validation-list');
    if (!ul) return;
    const checks = [
      { ok: /<html/i.test(content), label: 'Contains <html> tag' },
      { ok: !/<title>/i.test(content) || /<title>[^<]{1,120}<\/title>/i.test(content), label: 'Title tag looks good' },
      { ok: !/src=["']\//i.test(content) && !/href=["']\//i.test(content), label: 'No absolute paths (src="/…" or href="/…")' },
      { ok: /<meta\s[^>]*name=["']description/i.test(content), label: 'Has meta description' },
      { ok: content.length < 50 * 1024 * 1024, label: 'File size under 50 MB' },
    ];
    ul.innerHTML = checks.map(c =>
      `<li class="${c.ok ? 'ok' : 'err'}">${c.ok ? '✅' : '❌'} ${c.label}</li>`
    ).join('');
    return checks.every(c => c.ok);
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * GITHUB HELPERS
   * ────────────────────────────────────────────────────────────────────────── */
  async function ghGetSHA(token, path) {
    const h = host();
    const res = await fetch(`${h.GH_API}${path}`, {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json' }
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Cannot fetch ${path}: HTTP ${res.status}`);
    return (await res.json()).sha;
  }
  async function ghPushFile(token, path, content, sha, commitMsg, isBase64) {
    const encoded = isBase64 ? content : btoa(unescape(encodeURIComponent(content)));
    const body = { message: commitMsg, content: encoded };
    if (sha) body.sha = sha;
    const h = host();
    const res = await fetch(`${h.GH_API}${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Push failed for ${path}: ${res.status}`);
    }
  }
  async function imageToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = (ev) => resolve(ev.target.result.split(',')[1]);
      r.onerror = () => reject(new Error('File read error'));
      r.readAsDataURL(file);
    });
  }
  async function ghListDir(token, path) {
    const h = host();
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (token) headers['Authorization'] = `token ${token}`;
    const res = await fetch(`${h.GH_API}${path}`, { headers });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Cannot list ${path}: HTTP ${res.status}`);
    return res.json();
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * PUSH CATEGORIES TO GITHUB
   * ────────────────────────────────────────────────────────────────────────── */
  async function syncCategoriesToGitHub(token, log) {
    if (localStorage.getItem('rdj_blog_cats_dirty') !== '1') return false;
    const cats = getCategories();
    const h = host();
    const res = await fetch(`${h.GH_API}index.html`, {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json' }
    });
    if (!res.ok) throw new Error(`Could not fetch index.html for category sync: HTTP ${res.status}`);
    const data = await res.json();
    const sha = data.sha;
    let homeHtml = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));

    const blockRe = /(<script id="rdj-blog-cats" type="application\/json">)([\s\S]*?)(<\/script>)/;
    if (!blockRe.test(homeHtml)) throw new Error('Could not find the rdj-blog-cats data block in index.html');
    const newJson = JSON.stringify(cats, null, 2);
    homeHtml = homeHtml.replace(blockRe, (m, open, _old, close) => `${open}\n${newJson}\n${close}`);

    const encoded = btoa(unescape(encodeURIComponent(homeHtml)));
    const put = await fetch(`${h.GH_API}index.html`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: 'Update categories', content: encoded, sha })
    });
    if (!put.ok) {
      const err = await put.json().catch(() => ({}));
      throw new Error(err.message || `Category sync push failed: HTTP ${put.status}`);
    }

    localStorage.removeItem('rdj_blog_cats_dirty');
    renderAdminCats();
    return true;
  }

  function nowIST() {
    const now = new Date();
    const offset = 5 * 60 + 30;
    const local = new Date(now.getTime() + offset * 60000);
    const iso = local.toISOString().slice(0, 19);
    return iso + '+05:30';
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * CATEGORY PAGE BUILDER
   * ────────────────────────────────────────────────────────────────────────── */
  async function buildCategoryPage(token, catId, commitMsg) {
    const cats = getCategories();
    const cat = cats.find(c => c.id === catId) || { id: catId, name: catId, icon: '📁', desc: '' };
    const items = await ghListDir(token, catId);
    const slugFolders = items.filter(i => i.type === 'dir');
    const metas = (await Promise.all(
      slugFolders.map(async f => {
        try {
          const h = host();
          const res = await fetch(`${h.GH_API}${catId}/${f.name}/meta.json`, {
            headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json' }
          });
          if (!res.ok) return null;
          const data = await res.json();
          return JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, '')))));
        } catch (e) { return null; }
      })
    )).filter(Boolean);
    metas.sort((a, b) => new Date(b.date) - new Date(a.date));

    const postCards = metas.map(m => {
      const cover = m.cover ? `${m.slug}/${m.cover}` : null;
      const thumbHtml = cover
        ? `<img src="${cover}" alt="${m.title}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;">`
        : `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:linear-gradient(135deg,#084d44,#0d8a79);font-size:2.5rem;color:rgba(255,255,255,0.3);">📝</div>`;
      return `
  <article class="post-card">
    <div class="post-thumb">${thumbHtml}</div>
    <div class="post-body">
      <div class="post-meta">
        <span class="post-cat-tag">${m.category}</span>
        <time class="post-date" datetime="${m.date}">${fmtDate(m.date)}</time>
      </div>
      <h2 class="post-title">${m.title}</h2>
      <p class="post-desc">${m.description || ''}</p>
      <a class="post-read-more" href="${m.slug}/">Read More →</a>
    </div>
  </article>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-G5M1ZPJW29"><\/script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-G5M1ZPJW29');<\/script>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8728382905346597" crossorigin="anonymous"><\/script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${cat.name} Articles | RDJ Publishers Blog</title>
<meta name="description" content="Browse ${cat.name} articles on RDJ Publishers Blog. ${cat.desc}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://rdjpublishers.com/blogs/${catId}/">
<meta property="og:title" content="${cat.name} Articles | RDJ Publishers Blog">
<meta property="og:description" content="Browse ${cat.name} articles — free guides and tutorials.">
<meta property="og:url" content="https://rdjpublishers.com/blogs/${catId}/">
<meta property="og:image" content="https://rdjpublishers.com/blogs/blog.png">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"CollectionPage","name":"${cat.name} | RDJ Publishers Blog","url":"https://rdjpublishers.com/blogs/${catId}/","description":"${cat.desc}"}<\/script>
<link rel="icon" href="https://rdjpublishers.com/blogs/blog.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../search/pagefind-ui.css">
<script src="../search/pagefind-ui.js"><\/script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{--ink:#0f1e1c;--teal:#0b6e61;--teal-dark:#084d44;--teal-mid:#0d8a79;--teal-pale:#e6f4f2;--gold:#c8892a;--surface:#fff;--bg:#f5f7f7;--border:#dde8e6;--muted:#6b8c88;--r:14px;--serif:'DM Serif Display',Georgia,serif;--sans:'DM Sans',system-ui,sans-serif;}
body{font-family:var(--sans);background:var(--bg);color:var(--ink);}
a{text-decoration:none;color:inherit;}
nav{position:sticky;top:0;z-index:100;height:58px;background:rgba(255,255,255,.94);backdrop-filter:blur(14px);display:flex;align-items:center;padding:0 1.2rem;border-bottom:1px solid var(--border);gap:.8rem;}
nav .brand{font-family:var(--serif);font-size:1rem;}nav .brand span{color:var(--teal);}
nav .links{margin-left:auto;display:flex;gap:.2rem;}
nav .links a{font-size:.78rem;font-weight:600;padding:.3rem .75rem;border-radius:8px;color:var(--muted);}
nav .links a:hover{background:var(--teal-pale);color:var(--teal);}
.breadcrumb{font-size:.72rem;color:var(--muted);padding:.8rem 1.2rem;display:flex;gap:.3rem;align-items:center;flex-wrap:wrap;}
.breadcrumb a{color:var(--teal);}
.cat-hero{background:linear-gradient(135deg,var(--teal-dark),var(--teal-mid));padding:2rem 1.4rem 1.8rem;display:flex;align-items:flex-start;gap:1rem;}
.cat-hero .icon{font-size:2.5rem;}
.cat-hero h1{font-family:var(--serif);font-size:1.5rem;color:#fff;}
.cat-hero p{font-size:.8rem;color:rgba(255,255,255,.6);margin-top:.3rem;line-height:1.6;}
.search-wrap{padding:1rem 1.2rem 0;}
.pagefind-ui{--pagefind-ui-primary:var(--teal);}
.post-grid{display:grid;grid-template-columns:1fr;gap:1.1rem;padding:1.2rem 1.2rem 2rem;}
@media(min-width:600px){.post-grid{grid-template-columns:1fr 1fr;}}
@media(min-width:1024px){.post-grid{grid-template-columns:1fr 1fr 1fr;}}
.post-card{background:var(--surface);border-radius:var(--r);border:1.5px solid var(--border);overflow:hidden;box-shadow:0 2px 12px rgba(11,110,97,.08);display:flex;flex-direction:column;transition:all .22s;}
.post-card:hover{transform:translateY(-4px);box-shadow:0 6px 28px rgba(11,110,97,.14);border-color:var(--teal);}
.post-thumb{width:100%;aspect-ratio:16/9;overflow:hidden;flex-shrink:0;}
.post-body{padding:1rem;flex:1;display:flex;flex-direction:column;}
.post-meta{display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;}
.post-cat-tag{font-size:.6rem;text-transform:uppercase;letter-spacing:.1em;font-weight:700;color:var(--teal);background:var(--teal-pale);padding:.2rem .55rem;border-radius:100px;}
.post-date{font-size:.68rem;color:var(--muted);}
.post-title{font-family:var(--serif);font-size:1rem;color:var(--ink);line-height:1.35;margin-bottom:.4rem;flex:1;}
.post-desc{font-size:.8rem;color:var(--muted);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.post-read-more{display:inline-flex;align-items:center;gap:.3rem;margin-top:.8rem;font-size:.78rem;font-weight:700;color:var(--teal);}
footer{background:var(--ink);padding:1.5rem 1.2rem;margin-top:2rem;}
footer p{font-size:.73rem;color:rgba(255,255,255,.3);}
footer .fl{display:flex;flex-wrap:wrap;gap:.5rem 1.2rem;margin:.6rem 0;}
footer .fl a{font-size:.73rem;color:rgba(255,255,255,.4);}footer .fl a:hover{color:var(--gold);}
</style>
</head>
<body>
<nav>
  <a href="../" class="brand">RDJ <span>Blog</span></a>
  <div class="links">
    <a href="../">Home</a>
    <a href="https://rdjpublishers.com/" target="_blank">Tools</a>
  </div>
</nav>
<nav class="breadcrumb" aria-label="Breadcrumb">
  <a href="https://rdjpublishers.com/">Home</a> /
  <a href="../">Blog</a> /
  <span>${cat.name}</span>
</nav>
<div class="cat-hero">
  <div class="icon">${cat.icon}</div>
  <div>
    <h1>${cat.name}</h1>
    <p>${cat.desc}</p>
  </div>
</div>
<div class="search-wrap">
  <div id="search"></div>
</div>
<div class="post-grid">
  ${postCards || '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--muted);">No posts in this category yet.</div>'}
</div>
<footer>
  <p>© 2026 RDJ Publishers · Free guides &amp; tutorials</p>
  <div class="fl">
    <a href="../">Blog Home</a>
    <a href="https://rdjpublishers.com/">Tools</a>
    <a href="https://rdjpublishers.com/#contact">Contact</a>
  </div>
</footer>
\x3cscript\x3e
window.addEventListener('DOMContentLoaded',()=>{
  if(window.PagefindUI) new PagefindUI({element:'#search',showImages:false,showSubResults:true});
});
\x3c/script\x3e
</body></html>`;

    const sha = await ghGetSHA(token, `${catId}/index.html`);
    await ghPushFile(token, `${catId}/index.html`, html, sha, commitMsg);
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * SITEMAP
   * ────────────────────────────────────────────────────────────────────────── */
  async function buildSitemap(token, commitMsg) {
    const cats = getCategories();
    const BASE = 'https://rdjpublishers.com/blogs';
    const today = new Date().toISOString().slice(0, 10);
    const urlEntries = [];

    urlEntries.push(`  <url>\n    <loc>${BASE}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`);

    for (const cat of cats) {
      urlEntries.push(`\n  <!-- ══ Category: ${cat.name} ══ -->`);
      urlEntries.push(`  <url>\n    <loc>${BASE}/${cat.id}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`);

      let metas = [];
      try {
        const items = await ghListDir(token, cat.id);
        const slugFolders = items.filter(i => i.type === 'dir');
        const h = host();
        metas = (await Promise.all(
          slugFolders.map(async f => {
            try {
              const res = await fetch(`${h.GH_API}${cat.id}/${f.name}/meta.json`, {
                headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json' }
              });
              if (!res.ok) return null;
              const data = await res.json();
              return JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, '')))));
            } catch (e) { return null; }
          })
        )).filter(Boolean);
        metas.sort((a, b) => new Date(b.date) - new Date(a.date));
      } catch (e) {}

      for (const m of metas) {
        const lastmod = (m.date || today).slice(0, 10);
        urlEntries.push(`  <url>\n    <loc>${BASE}/${cat.id}/${m.slug}/</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`);
      }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries.join('\n')}\n</urlset>\n`;
    const sha = await ghGetSHA(token, `sitemap_blogs.xml`);
    await ghPushFile(token, `sitemap_blogs.xml`, xml, sha, commitMsg);
  }
  async function regenerateSitemap() {
    const token = document.getElementById('sm-token')?.value?.trim() || '';
    if (!token) { showToast('⚠️ GitHub token required'); return; }
    try {
      showToast('🔄 Regenerating sitemap…');
      await buildSitemap(token, 'Regenerate sitemap_blogs.xml');
      showToast('✅ Sitemap updated');
    } catch (err) {
      showToast('❌ ' + err.message);
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * PAGEFIND INJECT HELPERS
   * ────────────────────────────────────────────────────────────────────────── */
  function injectPagefindScript(html) {
    if (/src=["']\//i.test(html) || /href=["']\//i.test(html)) {
      throw new Error('❌ Absolute paths detected (src="/" or href="/"). Use relative paths instead, e.g. src="image.jpg" not src="/image.jpg".');
    }
    if (!/search\/pagefind-ui\.css/i.test(html)) {
      html = html.replace('</head>', '<link rel="stylesheet" href="../../search/pagefind-ui.css" onerror="this.remove()">\n</head>');
    }
    if (!/search\/pagefind-ui\.js/i.test(html)) {
      html = html.replace('</head>', '<script src="../../search/pagefind-ui.js"><\/script>\n</head>');
    }
    return html;
  }
  async function ensureHomepageSearch(token) {
    try {
      const h = host();
      const res = await fetch(`${h.GH_API}index.html`, {
        headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json' }
      });
      if (!res.ok) return;
      const data = await res.json();
      const sha = data.sha;
      let homeHtml = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));

      const hasSearchDiv    = /<div[^>]*id=["']search["']/i.test(homeHtml);
      const hasPagefindJs   = /search\/pagefind(\.js|-ui\.js)/i.test(homeHtml);
      const hasPagefindInit = /PagefindUI[\s\S]*?showSubResults\s*:\s*true/i.test(homeHtml);
      if (hasSearchDiv && hasPagefindJs && hasPagefindInit) return;

      const searchSection = [
        '<!-- Auto-injected Pagefind Search -->',
        '<link rel="stylesheet" href="search/pagefind-ui.css">',
        '\x3cscript src="search/pagefind-ui.js">\x3c/script>',
        '<section style="max-width:700px;margin:1.2rem auto;padding:0 1.2rem;">',
        '  <div id="search"></div>',
        '</section>',
        '\x3cscript>',
        'window.addEventListener(\'DOMContentLoaded\',function(){',
        '  if(window.PagefindUI){new PagefindUI({element:\'#search\',showImages:false,showSubResults:true});}',
        '});',
        '\x3c/script>'
      ].join('\n');

      if (!homeHtml.includes('</body>')) return;
      homeHtml = homeHtml.replace('</body>', searchSection + '\n</body>');

      const encoded = btoa(unescape(encodeURIComponent(homeHtml)));
      await fetch(`${h.GH_API}index.html`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: 'Auto-add Pagefind search bar [skip ci]',
          content: encoded,
          sha: sha
        })
      });
    } catch (e) {
      console.warn('ensureHomepageSearch: failed silently —', e.message);
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * PUBLISH POST
   * ────────────────────────────────────────────────────────────────────────── */
  async function publishPost() {
    if (!isAdmin) return;
    const token   = document.getElementById('gh-token')?.value?.trim() || '';
    const cat     = document.getElementById('f-cat')?.value?.trim() || '';
    const title   = document.getElementById('f-title')?.value?.trim() || '';
    const slug    = document.getElementById('f-slug')?.value?.trim() || '';
    const desc    = document.getElementById('f-desc')?.value?.trim() || '';
    const tagsRaw = document.getElementById('f-tags')?.value?.trim() || '';
    const cover   = document.getElementById('f-cover')?.value?.trim() || 'cover.jpg';

    if (!token) { showToast('⚠️ GitHub token required'); return; }
    if (!cat)   { showToast('⚠️ Category required'); return; }
    if (!title) { showToast('⚠️ Title required'); return; }
    if (!slug)  { showToast('⚠️ Slug required'); return; }
    if (!/^[a-z0-9-]+$/.test(slug)) { showToast('⚠️ Slug: lowercase a-z, 0-9, hyphens only'); return; }
    if (slug.length > 60) { showToast('⚠️ Slug max 60 chars'); return; }
    if (!pendingHtmlContent) { showToast('⚠️ Upload your HTML file first'); return; }
    if (!/<html/i.test(pendingHtmlContent)) { showToast('❌ HTML file must contain <html> tag'); return; }
    if (/src=["']\//i.test(pendingHtmlContent) || /href=["']\//i.test(pendingHtmlContent)) {
      showToast('❌ Use relative paths in HTML: src="image.jpg" not src="/image.jpg"');
      return;
    }

    const existSHA = await ghGetSHA(token, `${cat}/${slug}/meta.json`).catch(() => null);
    if (existSHA !== null && existSHA !== undefined) {
      showToast(`❌ Slug "${slug}" already exists in ${cat}/. Try "${slug}-2"`);
      return;
    }

    const btn = document.getElementById('publish-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Publishing…'; }
    const logEl = document.getElementById('publish-log');
    const box   = document.getElementById('publish-box');
    if (box) box.style.display = 'block';
    if (logEl) { logEl.innerHTML = ''; }

    function log(msg, type = 'info') {
      if (!logEl) return;
      const cls = type === 'ok' ? 'log-ok' : type === 'err' ? 'log-err' : 'log-info';
      logEl.innerHTML += `<span class="${cls}">${msg}</span>\n`;
      logEl.scrollTop = logEl.scrollHeight;
    }

    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
    const date = nowIST();
    const commitMsg = `Add post: ${cat}/${slug} - ${title}`;
    const basePath  = `${cat}/${slug}`;

    try {
      try {
        const synced = await syncCategoriesToGitHub(token, log);
        if (synced) log(`✅ Category changes synced to GitHub`, 'ok');
      } catch (catErr) {
        log(`⚠️ Category sync failed: ${catErr.message} (continuing with post publish)`, 'err');
      }

      log(`📤 Pushing ${basePath}/meta.json…`);
      const meta = { title, slug, category: cat, date, description: desc, tags, cover };
      await ghPushFile(token, `${basePath}/meta.json`, JSON.stringify(meta, null, 2), null, commitMsg);
      log(`✅ meta.json pushed`, 'ok');

      log(`📤 Pushing ${basePath}/index.html…`);
      let postHtml = pendingHtmlContent;
      if (!/<title>/i.test(postHtml)) {
        postHtml = postHtml.replace('</head>', `<title>${title} | RDJ Publishers</title>\n<meta name="description" content="${desc}">\n</head>`);
      }
      if (!/G-G5M1ZPJW29/.test(postHtml)) {
        const gaSnippet = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-G5M1ZPJW29"><\/script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-G5M1ZPJW29');<\/script>`;
        postHtml = postHtml.replace('<head>', `<head>\n${gaSnippet}`);
      }
      if (!/ca-pub-8728382905346597/.test(postHtml)) {
        const adsSnippet = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8728382905346597" crossorigin="anonymous"><\/script>`;
        postHtml = postHtml.replace('</head>', `${adsSnippet}\n</head>`);
      }
      postHtml = injectPagefindScript(postHtml);
      await ghPushFile(token, `${basePath}/index.html`, postHtml, null, commitMsg);
      log(`✅ index.html pushed`, 'ok');

      if (pendingImgFiles.length) {
        log(`📤 Pushing ${pendingImgFiles.length} image(s)…`);
        for (const file of pendingImgFiles) {
          const b64 = await imageToBase64(file);
          const imgPath = `${basePath}/${file.name}`;
          const imgSHA = await ghGetSHA(token, imgPath).catch(() => null);
          await ghPushFile(token, imgPath, b64, imgSHA, commitMsg, true);
          log(`✅ ${file.name} pushed`, 'ok');
        }
      }

      log(`🔄 Regenerating ${cat}/index.html…`);
      await buildCategoryPage(token, cat, commitMsg);
      log(`✅ ${cat}/index.html updated`, 'ok');

      log(`🔄 Updating sitemap_blogs.xml…`);
      await buildSitemap(token, commitMsg);
      log(`✅ sitemap_blogs.xml updated`, 'ok');

      log(`\n🎉 Post "${title}" published! Live in 5–10 min at:`, 'ok');
      log(`   https://rdjpublishers.com/blogs/${cat}/${slug}/`, 'ok');
      showToast('✅ Post published!');

      log(`🔍 Checking homepage search bar…`);
      await ensureHomepageSearch(token);

      // Best-effort: refresh home grid if the host page exposes the helper.
      if (typeof window.addPostToManifestCache === 'function' && typeof window.loadLatestPosts === 'function') {
        try { window.addPostToManifestCache(meta); window.loadLatestPosts(); } catch (e) {}
      }
    } catch (err) {
      log(`❌ ${err.message}`, 'err');
      showToast('❌ Publish failed. See log.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Publish Post'; }
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * DATE FORMATTER (used by category-page builder)
   * ────────────────────────────────────────────────────────────────────────── */
  function fmtDate(iso) {
    const d = new Date(iso);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * BOOT — wire triggers, restore unlocked state from localStorage.
   * ────────────────────────────────────────────────────────────────────────── */
  function boot() {
    wireTriggers();
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') {
        isAdmin = true;
        paintDots(true);
        // Don't auto-open the modal — just mark unlocked so the next
        // triple-click opens the panel directly.
      }
    } catch (e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
