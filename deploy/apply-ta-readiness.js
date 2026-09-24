#!/usr/bin/env node
// Adds TA Readiness AI to a task-tracker server whose working copy has local (uncommitted)
// changes, WITHOUT git pull: new files come from origin/master, server.js and
// public/index.html get only the TA insertions, everything else is left untouched.
//
// On the server, in the app folder, after `git fetch origin master deploy-tools`:
//   node apply-ta-readiness.js --check   # dry run: verifies every insertion point, writes nothing
//   node apply-ta-readiness.js           # backup, apply, npm install
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CHECK = process.argv.includes('--check');
const REF = 'origin/master';
const NEW_FILES = [
  'routes/taReadiness.js',
  'taReadinessDb.js',
  'services/taReview.js',
  'services/taDocPrep.js',
  'public/readiness/index.html',
  'public/readiness/readiness.css',
  'public/readiness/readiness.js',
];
const DEPS = ['@anthropic-ai/sdk', 'mammoth', 'pdfjs-dist', '@napi-rs/canvas'];

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const say = (m) => console.log(`\n==> ${m}`);
const fail = (m) => { console.error(`\nSTOPPED: ${m}\nNothing further was changed.`); process.exit(1); };

// ------------------------------------------------------------------ edits

// Each edit: find `anchor` exactly once, put `insert` before/after it (or replace it).
const SERVER_EDITS = [
  { anchor: "app.use('/reports', require('./routes/reports'));", after: "\napp.use('/readiness', require('./routes/taReadiness'));" },
  { anchor: '    await db.initDB();', after: "\n    await require('./taReadinessDb').init();" },
];

const INDEX_EDITS = [
  { anchor: '#reportsAppFrame{flex:1;min-height:0}', after: '\n#readinessAppFrame{flex:1;min-height:0}' },
  {
    anchor: '<iframe id="reportsIframe" src="about:blank" style="width:100%;height:100%;border:none;"></iframe>\n</div>',
    after: '\n<div id="readinessAppFrame" style="display:none">\n  <iframe id="readinessIframe" src="about:blank" style="width:100%;height:100%;border:none;"></iframe>\n</div>',
  },
  {
    anchor: "  const rIframe = document.getElementById('reportsIframe');\n  if (rIframe) rIframe.src = 'about:blank';\n  document.getElementById('appContainer').style.display = 'none';",
    replace: "  const rIframe = document.getElementById('reportsIframe');\n  if (rIframe) rIframe.src = 'about:blank';\n  const taIframe = document.getElementById('readinessIframe');\n  if (taIframe) taIframe.src = 'about:blank';\n  document.getElementById('appContainer').style.display = 'none';",
  },
  { anchor: "  report: '&#128221;'\n};", replace: "  report: '&#128221;',\n  ai: '&#10022;'\n};" },
  {
    anchor: "    if (appName === 'reports' && document.getElementById('reportsAppFrame').style.display !== 'none') return;",
    after: "\n    if (appName === 'ta readiness ai' && document.getElementById('readinessAppFrame').style.display !== 'none') return;",
  },
  { anchor: "['safety','users','reports','task tracker'].includes(appName)", replace: "['safety','users','reports','task tracker','ta readiness ai'].includes(appName)" },
  {
    anchor: "  if (titleEl && app) titleEl.innerHTML = '<span>' + esc(app.name) + '</span>';\n",
    after: `
  // TA Readiness AI — its own iframe app, like Reports
  const readinessFrame = document.getElementById('readinessAppFrame');
  readinessFrame.style.display = 'none';
  if (app && app.name.toLowerCase() === 'ta readiness ai') {
    trackerApp.style.display = 'none';
    customPlaceholder.style.display = 'none';
    safetyFrame.style.display = 'none';
    document.getElementById('usersAppFrame').style.display = 'none';
    document.getElementById('reportsAppFrame').style.display = 'none';
    readinessFrame.style.display = '';
    const iframe = document.getElementById('readinessIframe');
    if (!iframe.src || iframe.src === 'about:blank' || iframe.src === window.location.origin + '/') iframe.src = '/readiness/';
    toast('Switched to TA Readiness AI', 'success');
    return;
  }
`,
  },
];

function applyEdits(file, edits, marker) {
  let text = fs.readFileSync(file, 'utf8');
  const crlf = text.includes('\r\n');
  if (crlf) text = text.replace(/\r\n/g, '\n');
  if (text.includes(marker)) return { file, status: 'already applied', text: null };
  const problems = [];
  edits.forEach(e => {
    const n = text.split(e.anchor).length - 1;
    if (n !== 1) problems.push(`${file}: expected 1 match, found ${n} for:\n    ${e.anchor.split('\n')[0]}`);
  });
  if (problems.length) return { file, status: 'mismatch', problems };
  edits.forEach(e => {
    text = e.replace != null ? text.replace(e.anchor, () => e.replace) : text.replace(e.anchor, () => e.anchor + e.after);
  });
  return { file, status: 'ready', text: crlf ? text.replace(/\n/g, '\r\n') : text };
}

// ------------------------------------------------------------------ run

say(CHECK ? 'DRY RUN — nothing will be written' : 'Applying TA Readiness AI');
let pkg;
try { pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); } catch { fail('Run this inside the task-tracker folder (package.json not found).'); }
if (pkg.name !== 'task-tracker') fail(`This folder is "${pkg.name}", not task-tracker.`);
console.log('App folder:', process.cwd());

try { sh(`git rev-parse --verify ${REF}`); } catch { fail(`${REF} not found. Run: git fetch origin master`); }

// New files must exist on master.
const missing = NEW_FILES.filter(f => { try { sh(`git cat-file -e ${REF}:${f}`); return false; } catch { return true; } });
if (missing.length) fail(`Not on ${REF}: ${missing.join(', ')}`);

const plans = [
  applyEdits('server.js', SERVER_EDITS, "require('./routes/taReadiness')"),
  applyEdits('public/index.html', INDEX_EDITS, 'readinessAppFrame'),
];
plans.forEach(p => console.log(`  ${p.file}: ${p.status}`));
const bad = plans.filter(p => p.status === 'mismatch');
if (bad.length) fail(bad.map(p => p.problems.join('\n')).join('\n'));

const masterPkg = JSON.parse(sh(`git show ${REF}:package.json`));
const deps = DEPS.map(d => `${d}@${masterPkg.dependencies[d]}`);
console.log('  new files:', NEW_FILES.join(', '));
console.log('  packages :', deps.join(' '));

if (CHECK) { say('Dry run OK — every insertion point matched. Run again without --check to apply.'); process.exit(0); }

// Backup (code without node_modules, .env included).
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const backupDir = path.join(require('os').homedir(), 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const backup = path.join(backupDir, `task-tracker-before-ta-${stamp}.tgz`);
say(`Backing up to ${backup}`);
sh(`tar --force-local --exclude=./node_modules -czf "${backup}" .`);

say('Writing new files');
NEW_FILES.forEach(f => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, execSync(`git show ${REF}:${f}`, { maxBuffer: 64 * 1024 * 1024 }));
  console.log('  +', f);
});

say('Inserting TA lines into server.js and public/index.html');
plans.filter(p => p.status === 'ready').forEach(p => { fs.writeFileSync(p.file, p.text); console.log('  ~', p.file); });

say('Installing packages (this can take a minute)');
if (!process.argv.includes('--skip-install')) execSync(`npm install --omit=dev --no-audit --no-fund ${deps.join(' ')}`, { stdio: 'inherit' });

say('AI settings in .env');
const envText = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
if (!/^ANTHROPIC_WORKSPACE_ID=/m.test(envText)) {
  fs.appendFileSync('.env', `${envText && !envText.endsWith('\n') ? '\n' : ''}ANTHROPIC_WORKSPACE_ID=wrkspc_014EKNnMn61kR5hdsktjK5qb\n`);
  console.log('  workspace id added');
}
console.log(/^ANTHROPIC_API_KEY=.+/m.test(fs.readFileSync('.env', 'utf8'))
  ? '  API key already present'
  : '  API key NOT set yet: run `nano .env`, add ANTHROPIC_API_KEY=your-key on its own line, save.');

say('Done. Now restart the app (pm2 list, then pm2 restart <name>). Backup: ' + backup);
console.log('Roll back if needed:  tar -xzf "' + backup + '" -C ' + process.cwd() + '  then restart.');
