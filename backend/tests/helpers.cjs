const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { transformSync } = require("@babel/core");

function loadService(name, mocks) {
  const filename = path.resolve(__dirname, "../services", `${name}.js`);
  const localRequire = createRequire(filename);
  const { code } = transformSync(fs.readFileSync(filename, "utf8"), {
    filename, babelrc: false, configFile: false,
    plugins: ["@babel/plugin-transform-modules-commonjs"],
  });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, console,
    Blob: globalThis.Blob,
    fetch: (...args) => globalThis.fetch(...args),
    require: (id) => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id),
  }, { filename });
  return module.exports;
}

// In-memory adapter: checks read-before-write ordering and atomic commits.
// It is deliberately not a replacement for Firebase Emulator/Rules testing.
function fakeStore(initial = {}, options = {}) {
  const data = new Map(Object.entries(structuredClone(initial)));
  let sequence = 0;
  let queue = Promise.resolve();
  const reference = (name, id = `generated-${++sequence}`) => ({
    id, path: `${name}/${id}`,
    async get() { return snapshot(this); },
    async set(value) { data.set(this.path, value); },
    async update(value) {
      if (!data.has(this.path)) throw new Error("Missing document");
      data.set(this.path, { ...data.get(this.path), ...value });
    },
  });
  const snapshot = (ref) => {
    const value = structuredClone(data.get(ref.path));
    return { id: ref.id, ref, exists: data.has(ref.path), data: () => structuredClone(value) };
  };
  const comparable = (value) => value instanceof Date ? value.getTime()
    : typeof value?.toMillis === 'function' ? value.toMillis()
    : typeof value?.seconds === 'number' ? value.seconds * 1000 : value;
  function buildQuery(name, filters = [], settings = {}) {
    const [field, op, value] = filters[0] || [];
    return {
      name, field, op, value,
      where: (...clause) => buildQuery(name, [...filters, clause], settings),
      limit: (count) => buildQuery(name, filters, { ...settings, count }),
      orderBy: (order) => buildQuery(name, filters, { ...settings, order }),
      startAfter: (cursor) => buildQuery(name, filters, { ...settings, cursor }),
      count() {
        return { get: async () => {
          const result = await buildQuery(name, filters, settings).get();
          return { data: () => ({ count: result.size }) };
        } };
      },
      async get() {
        let docs = [...data.keys()].filter(path => path.startsWith(name + '/'))
          .map(path => snapshot({ path, id: path.slice(name.length + 1) }))
          .filter(doc => filters.every(([key, operator, expected]) => {
            const actual = doc.data()[key];
            if (operator === '==') return actual === expected;
            if (operator === 'in') return expected.includes(actual);
            if (operator === '<=') return actual !== undefined && comparable(actual) <= comparable(expected);
            throw new Error('Unsupported test query operator');
          }));
        const compare = (a, b) => {
          if (settings.order) {
            const av = comparable(a.data()[settings.order]);
            const bv = comparable(b.data()[settings.order]);
            if (av !== bv) return av < bv ? -1 : 1;
          }
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        };
        docs.sort(compare);
        if (settings.cursor) docs = docs.filter(doc => compare(doc, settings.cursor) > 0);
        if (settings.count !== undefined) docs = docs.slice(0, settings.count);
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
  }
  const collection = (name) => ({
    name, doc: (id) => reference(name, id),
    where: (...clause) => buildQuery(name, [clause]),
    async add(value) { const ref = reference(name); data.set(ref.path, value); return ref; },
  });
  const db = {
    collection,
    batch() {
      const updates = [];
      return {
        update(ref, value) { updates.push([ref, value]); },
        set(ref, value) { updates.push([ref, value, true]); },
        async commit() {
          if (options.failCommit) throw new Error("Commit rejected");
          if (updates.some(([ref, , isSet]) => !isSet && !data.has(ref.path))) throw new Error("Missing document");
          updates.forEach(([ref, value, isSet]) => data.set(ref.path, isSet ? value : { ...data.get(ref.path), ...value }));
        },
      };
    },
    runTransaction(callback) {
      const execute = async () => {
        let result;
        for (let attempt = 0; attempt < 2; attempt++) {
          const writes = [];
          const transaction = {
            async get(ref) {
              if (writes.length) throw new Error("Transaction read after write");
              if (ref.field) {
                return ref.get();
              }
              return snapshot(ref);
            },
            update: (ref, value) => writes.push(["update", ref, value]),
            set: (ref, value) => writes.push(["set", ref, value]),
            delete: (ref) => writes.push(["delete", ref]),
          };
          result = await callback(transaction);
          if (attempt === 0 && options.retryOnce) {
            options.retryOnce(data);
            options.retryOnce = null;
            continue;
          }
          if (options.failCommit) throw new Error("Commit rejected");
          for (const [kind, ref, value] of writes) {
            if (kind === "delete") data.delete(ref.path);
            else data.set(ref.path, kind === "set" ? value : { ...data.get(ref.path), ...value });
          }
          break;
        }
        return result;
      };
      const pending = queue.then(execute);
      queue = pending.catch(() => {});
      return pending;
    },
  };
  const runtime = {
    db, auth: { currentUser: { uid: "owner" } },
    persistenceReady: Promise.resolve(),
    authReady: Promise.resolve(),
    serverTimestamp: () => "server-time", deleteField: () => null,
  };
  const modular = {
    collection: (_db, name) => collection(name),
    doc: (parent, name, id) => parent === db ? reference(name, id) : parent.doc(name),
    getDoc: async (ref) => {
      const snapshot = await ref.get();
      return { ...snapshot, exists: () => snapshot.exists };
    },
    serverTimestamp: runtime.serverTimestamp,
    runTransaction: (_db, callback) => db.runTransaction((transaction) => callback({
      ...transaction,
      async get(ref) {
        const result = await transaction.get(ref);
        return { ...result, exists: () => result.exists };
      },
    })),
  };
  return { data, runtime, modular };
}

module.exports = { loadService, fakeStore };
