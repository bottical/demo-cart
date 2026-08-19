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
  manager.getDestinationConfig = async () => ({ maxSlotNo: 0 });
  manager.destinationDocId = (code) => encodeURIComponent(code);
  manager.destinationMaster = () => ({ doc: (id) => ref(`master/${id}`) });
  manager.destinationHistory = () => ({ doc: () => ref(`history/${writes.length}`) });
  manager.destinationConfig = () => ref('config/current');
  manager.db = {
    batch: () => ({
      set: (target, value, options) => writes.push({ type: 'set', target, value, options }),
      update: (target, value) => writes.push({ type: 'update', target, value }),
      delete: (target) => writes.push({ type: 'delete', target }),
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
  assert.equal(swap.writes.length, 5, 'config初期化・master・historyを同じWriteBatchへ入れる');
  assert.equal(swap.writes[0].value.maxSlotNo, 2, 'config未設定時は取込後の最大配置No.で初期化する');

  const invalid = managerWithBatch(current);
  await assert.rejects(
    invalid.manager.saveDestinationMasterEntries([{ destinationCode: 'C001', destinationName: 'C卸', slotNo: 1, enabled: true }]),
    /配置No\.001 が重複/
  );
  assert.equal(invalid.commits(), 0, '最終状態が不正なら書込みを開始しない');
  assert.equal(invalid.writes.length, 0, '部分更新を残さない');

  const overPhysicalLimit = managerWithBatch(current);
  overPhysicalLimit.manager.getDestinationConfig = async () => ({ maxSlotNo: 2 });
  await assert.rejects(
    overPhysicalLimit.manager.saveDestinationMasterEntries([{ destinationCode: 'C001', destinationName: 'C卸', slotNo: 3, enabled: true }]),
    /取込データに物理配置数（2）を超える配置No\.があります。\nNo\.003 C001 C卸/
  );
  assert.equal(overPhysicalLimit.commits(), 0, '物理配置数超過時はWriteBatchをcommitしない');
  assert.equal(overPhysicalLimit.writes.length, 0, '物理配置数超過時は書込みを開始しない');

  const firstEntry = managerWithBatch();
  firstEntry.manager.db.runTransaction = async (operation) => operation({
    get: async (target) => ({ exists: false, data: () => null, target }),
    set: (target, value) => firstEntry.writes.push({ type: 'set', target, value }),
    update: (target, value) => firstEntry.writes.push({ type: 'update', target, value })
  });
  await firstEntry.manager.saveDestinationMasterEntry({ destinationCode: 'G001', destinationName: 'G卸', slotNo: 7, enabled: true });
  assert.equal(firstEntry.writes[0].target.path, 'config/current');
  assert.equal(firstEntry.writes[0].value.maxSlotNo, 7, '初回単件登録の配置No.でconfigを初期化する');

  const entryOverPhysicalLimit = managerWithBatch();
  entryOverPhysicalLimit.manager.db.runTransaction = async (operation) => operation({
    get: async (target) => target.path === 'config/current'
      ? { exists: true, data: () => ({ maxSlotNo: 6 }) }
      : { exists: false, data: () => null },
    set: (target, value) => entryOverPhysicalLimit.writes.push({ type: 'set', target, value }),
    update: (target, value) => entryOverPhysicalLimit.writes.push({ type: 'update', target, value })
  });
  await assert.rejects(
    entryOverPhysicalLimit.manager.saveDestinationMasterEntry({ destinationCode: 'G001', destinationName: 'G卸', slotNo: 7, enabled: true }),
    /配置No\.007は現在の物理配置数（6）を超えています/
  );
  assert.equal(entryOverPhysicalLimit.writes.length, 0, '単件登録の物理配置数超過時はtransaction内で書込まない');

  const legacyEntries = [
    { destinationCode: 'C003', destinationName: 'C卸', slotNo: 3, enabled: true },
    { destinationCode: 'K011', destinationName: 'K卸', slotNo: 11, enabled: true }
  ];
  const legacyEdit = managerWithBatch(legacyEntries);
  legacyEdit.manager.db.runTransaction = async (operation) => operation({
    get: async (target) => target.path === 'config/current'
      ? { exists: false }
      : { exists: true, data: () => ({ ...legacyEntries[0] }) },
    set: (target, value) => legacyEdit.writes.push({ type: 'set', target, value }),
    update: (target, value) => legacyEdit.writes.push({ type: 'update', target, value })
  });
  await legacyEdit.manager.saveDestinationMasterEntry({ ...legacyEntries[0], destinationName: 'C卸変更' });
  assert.equal(legacyEdit.writes[0].value.maxSlotNo, 11, 'config未設定の単件編集は既存マスター全体の最大配置No.で初期化する');

  const oversized = managerWithBatch();
  const tooMany = Array.from({ length: 101 }, (_, index) => ({
    destinationCode: `D${index}`,
    destinationName: `仕分け先${index}`,
    slotNo: index + 1,
    enabled: true
  }));
  await assert.rejects(oversized.manager.saveDestinationMasterEntries(tooMany), /100件まで/);
  assert.equal(oversized.commits(), 0, '安全上限を超えた一括取込はcommitしない');

  const deletion = managerWithBatch(current);
  deletion.manager.db.runTransaction = async (operation) => operation({
    get: async (target) => target.path === 'config/current'
      ? { exists: false }
      : { exists: true, data: () => ({ ...current[0] }) },
    delete: (target) => deletion.writes.push({ type: 'delete', target }),
    set: (target, value) => deletion.writes.push({ type: 'set', target, value })
  });
  await deletion.manager.deleteDestinationMasterEntry('A001');
  assert.deepEqual(deletion.writes.map((v) => v.type), ['set', 'delete', 'set'], '物理配置数保持・master削除・履歴追加を同一transactionに入れる');
  assert.equal(deletion.writes[0].value.maxSlotNo, 2, 'config未設定の削除は削除前マスター全体の最大配置No.を保持する');
  assert.equal(deletion.writes[2].value.action, 'deleted');
  assert.deepEqual(deletion.writes[2].value.before, current[0]);
  assert.equal(deletion.writes[2].value.after, null);

  const legacyDeletion = managerWithBatch(legacyEntries);
  legacyDeletion.manager.db.runTransaction = async (operation) => operation({
    get: async (target) => target.path === 'config/current'
      ? { exists: false }
      : { exists: true, data: () => ({ ...legacyEntries[0] }) },
    delete: (target) => legacyDeletion.writes.push({ type: 'delete', target }),
    set: (target, value) => legacyDeletion.writes.push({ type: 'set', target, value })
  });
  await legacyDeletion.manager.deleteDestinationMasterEntry('C003');
  assert.equal(legacyDeletion.writes[0].value.maxSlotNo, 11, 'config未設定の削除は末尾以外でも削除前の最大配置No.を保持する');

  const configuredDeletion = managerWithBatch(current);
  configuredDeletion.manager.db.runTransaction = async (operation) => operation({
    get: async (target) => target.path === 'config/current'
      ? { exists: true, data: () => ({ maxSlotNo: 11 }) }
      : { exists: true, data: () => ({ ...current[0], slotNo: 11 }) },
    delete: (target) => configuredDeletion.writes.push({ type: 'delete', target }),
    set: (target, value) => configuredDeletion.writes.push({ type: 'set', target, value })
  });
  await configuredDeletion.manager.deleteDestinationMasterEntry('A001');
  assert.deepEqual(configuredDeletion.writes.map((v) => v.type), ['delete', 'set'], '既存の物理配置数は削除時に縮小しない');

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
