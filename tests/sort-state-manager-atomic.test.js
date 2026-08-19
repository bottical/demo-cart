const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const timestamp = { serverTimestamp: true };
const context = {
  console,
  window: {},
  firebase: {
    firestore: Object.assign(() => ({}), { FieldValue: { serverTimestamp: () => timestamp } })
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/sort-state-manager.js', 'utf8'), context);
const SortStateManager = context.window.SortStateManager;

const ref = (path) => ({ path });
function managerWithBatch(current = []) {
  const writes = [];
  let commits = 0;
  const manager = Object.create(SortStateManager.prototype);
  manager.user = { uid: 'u1', email: 'worker@example.com' };
  manager.getDestinationMaster = async () => current.map((v) => ({ ...v }));
  manager.destinationDocId = (code) => encodeURIComponent(code);
  manager.destinationMaster = () => ({ doc: (id) => ref(`master/${id}`) });
  manager.destinationHistory = () => ({ doc: () => ref(`history/${writes.length}`) });
  manager.db = {
    batch: () => ({
      set: (target, value, options) => writes.push({ type: 'set', target, value, options }),
      update: (target, value) => writes.push({ type: 'update', target, value }),
      commit: async () => { commits += 1; }
    })
  };
  return { manager, writes, commits: () => commits };
}

(async () => {
  const current = [
    { destinationCode: 'A001', destinationName: 'A卸', slotNo: 1, enabled: true },
    { destinationCode: 'B001', destinationName: 'B卸', slotNo: 2, enabled: true }
  ];
  const swap = managerWithBatch(current);
  await swap.manager.saveDestinationMasterEntries([
    { ...current[0], slotNo: 2 },
    { ...current[1], slotNo: 1 }
  ]);
  assert.equal(swap.commits(), 1, '複数配置入替は1回だけcommitする');
  assert.equal(swap.writes.length, 4, 'masterとhistoryを同じWriteBatchへ入れる');

  const invalid = managerWithBatch(current);
  await assert.rejects(
    invalid.manager.saveDestinationMasterEntries([{ destinationCode: 'C001', destinationName: 'C卸', slotNo: 1, enabled: true }]),
    /配置No\.001 が重複/
  );
  assert.equal(invalid.commits(), 0, '最終状態が不正なら書込みを開始しない');
  assert.equal(invalid.writes.length, 0, '部分更新を残さない');

  const oversized = managerWithBatch();
  const tooMany = Array.from({ length: 101 }, (_, index) => ({
    destinationCode: `D${index}`,
    destinationName: `仕分け先${index}`,
    slotNo: index + 1,
    enabled: true
  }));
  await assert.rejects(oversized.manager.saveDestinationMasterEntries(tooMany), /100件まで/);
  assert.equal(oversized.commits(), 0, '安全上限を超えた一括取込はcommitしない');

  const replacement = managerWithBatch();
  replacement.manager.sortBatches = () => ({ doc: () => ref('batches/new') });
  replacement.manager.batchDoc = (id) => ref(`batches/${id}`);
  replacement.manager.db.batch = () => ({
    set: (target, value, options) => replacement.writes.push({ type: 'set', target, value, options }),
    update: (target, value) => replacement.writes.push({ type: 'update', target, value }),
    commit: async () => {}
  });
  // state read precedes the atomic WriteBatch; all three mutations are committed together.
  replacement.manager.sortDoc = () => ({ path: 'state/current', get: async () => ({ exists: true, data: () => ({ activeBatchId: 'old' }) }) });
  await replacement.manager.replaceActiveBatch({ batchName: 'next' });
  assert.deepEqual(replacement.writes.map((v) => v.type), ['set', 'update', 'set']);

  console.log('sort state manager atomic tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
