const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const elements = new Map();
const element = (id) => {
  if (!elements.has(id)) elements.set(id, {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    focus() {},
    addEventListener(type, handler) { this[`${type}Handler`] = handler; }
  });
  return elements.get(id);
};

let stateListener;
let activeBatch = null;
let updateError = null;
class SortStateManager {
  constructor(onState) { stateListener = onState; }
  async getActiveBatch() { return activeBatch; }
  batchDoc() { return { update: async () => { if (updateError) throw updateError; } }; }
  async setActiveSku() {}
}

const sounds = [];
const context = {
  console,
  setTimeout: (callback) => callback(),
  location: {},
  window: {
    AudioManager: {
      playStartSound: () => sounds.push('start'),
      playMultipleStartSound: () => sounds.push('multiple'),
      playCompleteSound: () => sounds.push('complete'),
      playErrorSound: () => sounds.push('error')
    }
  },
  document: {
    addEventListener(type, callback) { if (type === 'DOMContentLoaded') callback(); },
    getElementById: element,
    createElement: () => ({ click() {} })
  },
  SortStateManager,
  firebase: { firestore: { FieldValue: { serverTimestamp: () => 'timestamp' } } },
  Blob: class Blob {},
  URL: { createObjectURL: () => 'blob:test' }
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/pages/sort-scan.js', 'utf8'), context);

const allocation = (status) => ({ status, sortSlotId: 'slot-1', requiredQty: 1 });
const snapshot = ({ itemKey = 'sku-a', itemStatus = 'active', allocationStatus = 'required', batchId = 'batch-1' } = {}) => ({
  sortState: { activeBatchId: batchId, activeItemKey: itemKey },
  batch: {
    id: batchId,
    items: {
      [itemKey]: {
        status: itemStatus,
        allocations: { 'slot-1': allocation(allocationStatus) }
      }
    }
  }
});

(async () => {
// 初回snapshotと同一状態の再通知は無音にする。
const initial = snapshot();
stateListener(initial);
stateListener(initial);
assert.deepEqual(sounds, []);

// required -> doneはstart、最後の完了でSKUもcompletedになった場合はcompleteだけにする。
stateListener(snapshot({ allocationStatus: 'done', itemStatus: 'partial' }));
assert.deepEqual(sounds, ['start']);
stateListener(snapshot({ allocationStatus: 'required', itemStatus: 'partial' }));
assert.deepEqual(sounds, ['start', 'error']);
stateListener(snapshot({ allocationStatus: 'done', itemStatus: 'completed' }));
assert.deepEqual(sounds, ['start', 'error', 'complete']);

// completed状態の再通知、バッチ切替、SKU切替は新しいbaselineなので無音にする。
stateListener(snapshot({ allocationStatus: 'done', itemStatus: 'completed' }));
stateListener(snapshot({ allocationStatus: 'done', itemStatus: 'completed', batchId: 'batch-2' }));
stateListener(snapshot({ allocationStatus: 'done', itemStatus: 'completed', batchId: 'batch-2', itemKey: 'sku-b' }));
assert.deepEqual(sounds, ['start', 'error', 'complete']);

// 同一snapshot内の複数allocation遷移でも同じ音を連打しない。
const beforeMultiple = snapshot({ batchId: 'batch-2', itemKey: 'sku-c' });
beforeMultiple.batch.items['sku-c'].allocations['slot-2'] = allocation('required');
stateListener(beforeMultiple);
const afterMultiple = snapshot({ batchId: 'batch-2', itemKey: 'sku-c', allocationStatus: 'done', itemStatus: 'partial' });
afterMultiple.batch.items['sku-c'].allocations['slot-2'] = allocation('done');
stateListener(afterMultiple);
assert.deepEqual(sounds, ['start', 'error', 'complete', 'start']);

// 同一snapshotに取消と完了が含まれる場合は、取消警告だけを優先する。
const beforeMixed = snapshot({ batchId: 'batch-2', itemKey: 'sku-d', allocationStatus: 'done', itemStatus: 'partial' });
beforeMixed.batch.items['sku-d'].allocations['slot-2'] = allocation('required');
stateListener(beforeMixed);
const afterMixed = snapshot({ batchId: 'batch-2', itemKey: 'sku-d', allocationStatus: 'required', itemStatus: 'partial' });
afterMixed.batch.items['sku-d'].allocations['slot-2'] = allocation('done');
stateListener(afterMixed);
assert.deepEqual(sounds, ['start', 'error', 'complete', 'start', 'error']);

// スキャン受付音は数量と完了状態で選び、未取込・未登録・同期失敗はerrorにする。
const scanInput = element('scanInput');
const scan = async (jan) => {
  scanInput.value = jan;
  await scanInput.keydownHandler({ key: 'Enter', target: scanInput });
};
sounds.length = 0;
await scan('missing-batch');
activeBatch = { id: 'batch-2', items: {} };
await scan('unknown');
activeBatch.items.one = { status: 'active', totalQty: 1, allocations: {} };
await scan('one');
activeBatch.items.many = { status: 'active', totalQty: 2, allocations: {} };
await scan('many');
activeBatch.items.done = { status: 'completed', totalQty: 1, allocations: {} };
await scan('done');
updateError = new Error('offline');
await scan('one');
assert.deepEqual(sounds, ['error', 'error', 'start', 'multiple', 'error', 'start', 'error']);

console.log('sort scan audio transition tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
