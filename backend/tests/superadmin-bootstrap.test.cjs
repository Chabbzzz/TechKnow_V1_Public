const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../../web/superadmin-bootstrap.js'), 'utf8');

async function boot(search, failLoad = false) {
  const scripts = [];
  const notice = { hidden: true, classList: { add() {} }, setAttribute() {} };
  vm.runInNewContext(code, {
    URLSearchParams, window: { location: { search } },
    document: {
      createElement: () => ({}),
      getElementById: () => notice,
      body: { appendChild(script) { scripts.push(script.src); if (failLoad) script.onerror(); else script.onload(); } },
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { scripts, notice };
}

test('explicit preview never loads Firebase, authentication, or live data code', async () => {
  const { scripts } = await boot('?preview=1');
  assert.deepEqual(scripts, ['superadmin-preview.js']);
  assert.equal(scripts.some(source => /firebase|backend|superadmin-data/.test(source)), false);
});

test('all live access loads the real session guard before the dashboard', async () => {
  for (const search of ['', '?preview=0', '?preview=true', '?mode=unknown']) {
    const { scripts } = await boot(search);
    const guard = scripts.indexOf('../backend/services/admin.js');
    const adapter = scripts.findIndex(source => source.includes('dashboard-data.js'));
    assert.ok(guard >= 0 && adapter > guard);
    assert.equal(scripts.includes('superadmin-preview.js'), false);
    assert.ok(scripts[0].includes('firebase-app-compat.js'));
  }
});

test('a failed live dependency stops loading and displays an error without falling back to preview', async () => {
  const { scripts, notice } = await boot('', true);
  assert.equal(scripts.length, 1);
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /could not load/);
  assert.equal(scripts.includes('superadmin-preview.js'), false);
});
