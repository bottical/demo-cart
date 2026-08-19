(function () {
  const MAX_DESTINATION_MASTER_IMPORT_ENTRIES = 100;

  function ensureFirebaseApp() {
    if (!window.firebase) {
      throw new Error('Firebase SDK が読み込まれていません。');
    }

    if (firebase.apps && firebase.apps.length > 0) {
      return;
    }

    const config =
      (typeof firebaseConfig !== 'undefined' && firebaseConfig)
        ? firebaseConfig
        : window.firebaseConfig;

    if (!config) {
      throw new Error('firebaseConfig が見つかりません。js/firebase-config.js の読み込み順または定義を確認してください。');
    }

    firebase.initializeApp(config);
  }

  class SortStateManager {
    constructor(onState, onAuth) {
      ensureFirebaseApp();

      this.onState = onState;
      this.onAuth = onAuth;
      this.db = firebase.firestore();
      this.auth = firebase.auth();
      this.user = null;
      this.sortUnsub = null;
      this.batchUnsub = null;
      this.currentSortState = null;
      this.currentBatch = null;
      this.currentBatchId = null;

      this.auth.onAuthStateChanged((u) => {
        this.user = u;
        this.onAuth && this.onAuth(u);
        this.unsubscribeAll();
        if (!u) {
          this.onState && this.onState(null);
          return;
        }
        this.subscribe();
      });
    }

    ensureAuth() { if (!this.user) throw new Error('未ログインです'); }
    sortDoc() { return this.db.collection('users').doc(this.user.uid).collection('sortState').doc('current'); }
    sortBatches() { return this.db.collection('users').doc(this.user.uid).collection('sortBatches'); }
    batchDoc(batchId) { return this.sortBatches().doc(batchId); }
    destinationMaster() { return this.db.collection('users').doc(this.user.uid).collection('sortDestinationMaster'); }
    destinationHistory() { return this.db.collection('users').doc(this.user.uid).collection('sortDestinationMasterHistory'); }
    destinationDocId(code) { return encodeURIComponent(String(code).trim()).replace(/\./g, '%2E'); }

    async getDestinationMaster() {
      this.ensureAuth();
      const snap = await this.destinationMaster().get();
      return snap.docs.map((d) => ({ ...d.data() })).sort((a, b) => Number(a.slotNo) - Number(b.slotNo));
    }

    async saveDestinationMasterEntry(entry, options = {}) {
      this.ensureAuth();
      const value = {
        destinationCode: String(entry.destinationCode || '').trim(),
        destinationName: String(entry.destinationName || '').trim(),
        slotNo: Number(entry.slotNo), enabled: entry.enabled !== false
      };
      if (!value.destinationCode || !value.destinationName || !Number.isInteger(value.slotNo) || value.slotNo < 1) throw new Error('入力内容を確認してください');
      // Transaction.get() は DocumentReference 専用のため、競合候補は transaction 外で特定する。
      const entries = await this.getDestinationMaster();
      const existing = entries.find((v) => v.destinationCode === value.destinationCode) || null;
      const occupiedEntry = entries.find((v) => v.destinationCode !== value.destinationCode && Number(v.slotNo) === value.slotNo) || null;
      if (occupiedEntry && !options.swap) throw new Error(`配置No.${String(value.slotNo).padStart(3, '0')}は「${occupiedEntry.destinationName}」が使用しています`);
      const targetRef = this.destinationMaster().doc(this.destinationDocId(value.destinationCode));
      const occupiedRef = occupiedEntry ? this.destinationMaster().doc(this.destinationDocId(occupiedEntry.destinationCode)) : null;
      await this.db.runTransaction(async (tx) => {
        const oldSnap = await tx.get(targetRef);
        const occupiedSnap = occupiedRef ? await tx.get(occupiedRef) : null;
        const old = oldSnap.exists ? oldSnap.data() : null;
        const occupied = occupiedSnap?.exists ? occupiedSnap.data() : null;
        if (!!existing !== !!old) throw new Error('マスターが別の端末で変更されました。再読み込みしてください');
        if (occupiedEntry && (!occupied || Number(occupied.slotNo) !== value.slotNo)) throw new Error('配置が別の端末で変更されました。再読み込みしてください');
        const stamp = firebase.firestore.FieldValue.serverTimestamp();
        const actor = this.user.email || this.user.uid;
        if (occupied) {
          tx.update(occupiedRef, { slotNo: Number(old.slotNo), updatedAt: stamp, updatedBy: actor });
          tx.set(this.destinationHistory().doc(), { destinationCode: occupied.destinationCode, action: 'slot_changed', before: { slotNo: occupied.slotNo }, after: { slotNo: old.slotNo }, changedAt: stamp, changedBy: actor });
        }
        tx.set(targetRef, { ...value, updatedAt: stamp, updatedBy: actor }, { merge: true });
        const action = !old ? 'created' : old.enabled !== value.enabled ? (value.enabled ? 'enabled' : 'disabled') : Number(old.slotNo) !== value.slotNo ? 'slot_changed' : old.destinationName !== value.destinationName ? 'name_changed' : 'updated';
        tx.set(this.destinationHistory().doc(), { destinationCode: value.destinationCode, action, before: old, after: value, changedAt: stamp, changedBy: actor });
      });
    }

    async saveDestinationMasterEntries(importEntries) {
      this.ensureAuth();
      const incoming = importEntries.map((entry) => ({
        destinationCode: String(entry.destinationCode || '').trim(),
        destinationName: String(entry.destinationName || '').trim(),
        slotNo: Number(entry.slotNo),
        enabled: entry.enabled !== false
      }));
      const codeSet = new Set();
      if (incoming.length > MAX_DESTINATION_MASTER_IMPORT_ENTRIES) {
        throw new Error(`一度に反映できる件数は${MAX_DESTINATION_MASTER_IMPORT_ENTRIES}件までです`);
      }
      incoming.forEach((v) => {
        if (!v.destinationCode || !v.destinationName || !Number.isInteger(v.slotNo) || v.slotNo < 1) throw new Error('取込データに不正な行があります');
        if (codeSet.has(v.destinationCode)) throw new Error(`仕分け先コード ${v.destinationCode} が複数行に存在します`);
        codeSet.add(v.destinationCode);
      });
      const current = await this.getDestinationMaster();
      const finalByCode = new Map(current.map((v) => [v.destinationCode, { ...v }]));
      incoming.forEach((v) => finalByCode.set(v.destinationCode, v));
      const slotOwner = new Map();
      finalByCode.forEach((v) => {
        const prior = slotOwner.get(v.slotNo);
        if (prior) throw new Error(`配置No.${String(v.slotNo).padStart(3, '0')} が重複しています（${prior.destinationCode} / ${v.destinationCode}）`);
        slotOwner.set(v.slotNo, v);
      });
      const stamp = firebase.firestore.FieldValue.serverTimestamp();
      const actor = this.user.email || this.user.uid;
      const batch = this.db.batch();
      incoming.forEach((v) => {
        const old = current.find((x) => x.destinationCode === v.destinationCode) || null;
        const action = !old ? 'created' : old.enabled !== v.enabled ? (v.enabled ? 'enabled' : 'disabled') : Number(old.slotNo) !== v.slotNo ? 'slot_changed' : old.destinationName !== v.destinationName ? 'name_changed' : 'updated';
        batch.set(this.destinationMaster().doc(this.destinationDocId(v.destinationCode)), { ...v, updatedAt: stamp, updatedBy: actor }, { merge: true });
        batch.set(this.destinationHistory().doc(), { destinationCode: v.destinationCode, action, before: old, after: v, changedAt: stamp, changedBy: actor });
      });
      await batch.commit();
    }

    async disableDestinationMasterEntry(code) {
      const entries = await this.getDestinationMaster();
      const entry = entries.find((v) => v.destinationCode === code);
      if (!entry) throw new Error('仕分け先が見つかりません');
      return this.saveDestinationMasterEntry({ ...entry, enabled: false });
    }

    unsubscribeAll() {
      if (this.sortUnsub) this.sortUnsub();
      if (this.batchUnsub) this.batchUnsub();
      this.sortUnsub = null;
      this.batchUnsub = null;
      this.currentSortState = null;
      this.currentBatch = null;
      this.currentBatchId = null;
    }

    emitState() {
      this.onState && this.onState({
        sortState: this.currentSortState || {},
        batch: this.currentBatch
      });
    }

    subscribeActiveBatch(batchId) {
      if (this.currentBatchId === batchId) return;
      if (this.batchUnsub) this.batchUnsub();
      this.batchUnsub = null;
      this.currentBatchId = batchId || null;
      this.currentBatch = null;

      if (!batchId) {
        this.emitState();
        return;
      }

      this.batchUnsub = this.batchDoc(batchId).onSnapshot((batchSnap) => {
        this.currentBatch = batchSnap.exists ? { id: batchSnap.id, ...batchSnap.data() } : null;
        this.emitState();
      }, (err) => {
        console.error('activeBatch onSnapshot failed', err);
        this.currentBatch = null;
        this.emitState();
      });
    }

    subscribe() {
      this.sortUnsub = this.sortDoc().onSnapshot((s) => {
        const state = s.exists ? s.data() : {};
        this.currentSortState = state;
        this.subscribeActiveBatch(state?.activeBatchId || null);
        this.emitState();
      });
    }

    async getBatch(batchId) {
      const snap = await this.batchDoc(batchId).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    }

    async getActiveBatch() {
      this.ensureAuth();
      const stateSnap = await this.sortDoc().get();
      const state = stateSnap.exists ? stateSnap.data() : {};
      if (!state?.activeBatchId) return null;
      return this.getBatch(state.activeBatchId);
    }

    async replaceActiveBatch(payload) {
      this.ensureAuth();
      // v0.1: 初期想定は約30SKUのため単一ドキュメントで保持。
      // SKU/仕分け先の増加時は items サブコレクション化し、Firestore 1MB制限を回避すること。
      const ref = this.sortBatches().doc();
      const stateSnap = await this.sortDoc().get();
      const activeBatchId = stateSnap.exists ? stateSnap.data().activeBatchId : null;
      const stamp = firebase.firestore.FieldValue.serverTimestamp();
      const batch = this.db.batch();
      batch.set(ref, {
        ...payload,
        status: 'active',
        createdAt: stamp,
        updatedAt: stamp
      });
      if (activeBatchId) batch.update(this.batchDoc(activeBatchId), { status: 'replaced', updatedAt: stamp });
      batch.set(this.sortDoc(), {
        activeBatchId: ref.id,
        activeItemKey: null,
        activeJan: null,
        previousSkuSummary: null,
        updatedAt: stamp
      }, { merge: true });
      await batch.commit();
      return ref.id;
    }

    async createBatch(payload) { return this.replaceActiveBatch(payload); }

    async setActiveSku(activeItemKey, jan, prev) {
      this.ensureAuth();
      await this.sortDoc().set({
        activeItemKey: activeItemKey || null,
        activeJan: jan || null,
        previousSkuSummary: prev || null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    async resetAll() {
      this.ensureAuth();
      const snaps = await this.sortBatches().get();
      const b = this.db.batch();
      snaps.forEach((d) => b.delete(d.ref));
      b.delete(this.sortDoc());
      await b.commit();
    }
  }

  window.SortStateManager = SortStateManager;
})();
