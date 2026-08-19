const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
    console,
    Date,
    Math,
    Promise,
    setTimeout,
    clearTimeout,
    performance: { now: () => 0 },
    location: { pathname: '/test' },
    navigator: { userAgent: 'node', onLine: true },
    localStorage: { getItem: () => null },
    document: { documentElement: { dataset: {} }, visibilityState: 'visible' },
    firebase: {
        firestore: {
            FieldValue: {
                serverTimestamp: () => ({ serverTimestamp: true }),
                delete: () => ({ delete: true }),
                increment: (value) => ({ increment: value })
            }
        }
    }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
const stateManagerSource = fs.readFileSync('js/state-manager.js', 'utf8');
vm.runInContext(stateManagerSource, context);

const StateManager = context.StateManager;
const manager = Object.create(StateManager.prototype);
const now = Date.now();

const blockFor = (state) => manager._getDataOperationBlockFromState(state, now);
assert.equal(blockFor({ systemOperation: { type: 'RESET', status: 'processing', startedAt: now } }).code, 'reset-processing');
assert.equal(blockFor({ systemOperation: { type: 'RESET', status: 'processing', startedAt: now - 31 * 60 * 1000 } }).code, 'reset-processing-expired');
assert.equal(blockFor({ systemOperation: { type: 'RESET', status: 'failed' } }).code, 'reset-failed');
assert.equal(blockFor({ importIntegrity: { status: 'processing', startedAt: now - 31 * 60 * 1000 } }).code, 'import-processing-expired');
assert.equal(blockFor({ importIntegrity: { status: 'success' } }).blocked, false);
assert.throws(
    () => manager._assertWorkOperationAllowedFromState({ systemOperation: { type: 'RESET', status: 'failed' } }),
    (error) => error.code === 'reset-failed'
);

manager.user = { uid: 'user-1' };
manager._getStateDocRef = () => ({ id: 'current' });
manager.db = {
    runTransaction: async (callback) => callback({
        get: async () => ({
            exists: true,
            data: () => ({
                systemOperation: {
                    type: 'RESET',
                    status: 'processing',
                    operationId: 'old-reset',
                    startedAt: now - 31 * 60 * 1000
                }
            })
        }),
        update: () => assert.fail('stale RESET must not be overwritten by IMPORT')
    })
};

(async () => {
    await assert.rejects(
        manager.beginImportIntegrityLock({ operationId: 'new-import', startedAt: now }),
        (error) => error.code === 'reset-recovery-required'
    );

    const staleClient = Object.create(StateManager.prototype);
    staleClient.user = { uid: 'user-1' };
    staleClient.state = { importIntegrity: { status: 'success' } };
    staleClient._getStateDocRef = () => ({ id: 'current' });
    staleClient._logFirestoreError = () => {};
    staleClient.db = {
        runTransaction: async (callback) => callback({
            get: async () => ({ exists: true, data: () => ({ systemOperation: { type: 'RESET', status: 'processing', startedAt: now } }) }),
            update: () => assert.fail('server RESET must block stale client update')
        })
    };
    await assert.rejects(staleClient.update({ mode: 'INJECT' }), (error) => error.code === 'reset-processing');

    let committedPayload = null;
    staleClient.db.runTransaction = async (callback) => callback({
        get: async () => ({ exists: true, data: () => ({ importIntegrity: { status: 'success' } }) }),
        update: (_ref, payload) => { committedPayload = payload; }
    });
    await staleClient.update({ mode: 'INJECT' });
    assert.equal(committedPayload.mode, 'INJECT');

    const backfill = Object.create(StateManager.prototype);
    Object.assign(backfill, {
        progressSummaryBackfillCompleted: false,
        progressSummaryBackfillInFlight: false,
        progressCountedBackfillCompleted: false,
        progressCountedBackfillInFlight: false,
        progressCountedBackfillFailed: false,
        migrationCompleted: false,
        migrationInFlight: false,
        _logFirestoreError: () => assert.fail('operation blocks are not communication errors'),
        _getStateDocRef: () => ({ kind: 'state' }),
        _getPickListDocRef: (_uid, id) => ({ kind: 'pick', id }),
        _getBatchChunkSize: () => 450
    });
    let backfillWrites = 0;
    backfill.db = {
        runTransaction: async (callback) => callback({
            get: async () => ({ exists: true, data: () => ({ importIntegrity: { status: 'processing', startedAt: now } }) }),
            update: () => { backfillWrites += 1; }
        })
    };
    await backfill._backfillProgressSummaryIfNeeded('user-1', { pickLists: { old: [] } });
    assert.equal(backfillWrites, 0);
    assert.equal(backfill.progressSummaryBackfillCompleted, false);
    assert.equal(backfill.progressSummaryBackfillInFlight, false);
    backfill.db.runTransaction = async (callback) => callback({
        get: async () => ({ exists: true, data: () => ({ pickLists: { old: [] } }) }),
        update: () => { backfillWrites += 1; }
    });
    await backfill._backfillProgressSummaryIfNeeded('user-1', { pickLists: { old: [] } });
    assert.equal(backfillWrites, 1);
    assert.equal(backfill.progressSummaryBackfillCompleted, true);

    const pickRef = { kind: 'pick', id: 'same-id' };
    backfill._getPickListCollectionRef = () => ({
        get: async () => ({ empty: false, docs: [{ ref: pickRef, data: () => ({ lines: [] }) }] })
    });
    const writesBeforeCountedBackfill = backfillWrites;
    backfill.db.runTransaction = async (callback) => callback({
        get: async (ref) => ref.kind === 'state'
            ? { exists: true, data: () => ({ importIntegrity: { status: 'success' } }) }
            : { exists: true, data: () => ({ lines: [], progressCountedCompleted: false }) },
        update: () => { backfillWrites += 1; }
    });
    await backfill._backfillProgressCountedCompletedIfNeeded('user-1', { progressSummary: { total: 1, completed: 0 } });
    assert.equal(backfillWrites, writesBeforeCountedBackfill);
    assert.equal(backfill.progressCountedBackfillCompleted, true);

    let migrationWrites = 0;
    backfill.db.runTransaction = async (callback) => callback({
        get: async () => ({ exists: true, data: () => ({ importIntegrity: { status: 'success' }, pickLists: { old: [] } }) }),
        set: () => { migrationWrites += 1; },
        update: () => { migrationWrites += 1; }
    });
    await backfill._migrateLegacyPickListsIfNeeded('user-1', { pickLists: { old: [] }, janIndex: {} });
    assert.equal(migrationWrites, 0);
    assert.equal(backfill.migrationCompleted, false);
    assert.equal(backfill.migrationInFlight, false);

    backfill.db.runTransaction = async (callback) => callback({
        get: async () => ({ exists: true, data: () => ({ systemOperation: { type: 'RESET', status: 'processing', startedAt: now }, activePick: {} }) }),
        update: () => assert.fail('userStates migration must stop after RESET starts')
    });
    await backfill.migrateToMultiUser('user-1', { activePick: {} });

    const restore = Object.create(StateManager.prototype);
    restore.user = { uid: 'user-1' };
    restore.state = { systemOperation: { type: 'RESET', status: 'processing', startedAt: now } };
    await assert.rejects(restore.restoreLatestStateBackup(), (error) => error.code === 'reset-processing');

    assert.match(stateManagerSource, /if \(!operationBlock\.blocked\) \{[\s\S]*?_migrateLegacyPickListsIfNeeded[\s\S]*?_backfillProgressSummaryIfNeeded[\s\S]*?_backfillProgressCountedCompletedIfNeeded/);
    console.log('import operation block tests passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
