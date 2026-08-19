(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const mgr = new SortStateManager(() => { }, (u) => { if (!u) location.href = 'index.html'; });
    const SORT_IMPORT_COLUMNS_KEY = 'shelflow.sortImport.columns.v1';
    const COLUMN_INPUT_IDS = ['colJan', 'colDest', 'colQty', 'colLabel', 'colDestCode'];
    const msg = $('msg');
    const preview = $('preview');
    const warningsPreview = $('warningsPreview');

    const setMessage = (text, color = 'var(--success)') => {
      msg.style.color = color;
      msg.textContent = text;
    };

    const saveColumns = () => {
      const payload = {};
      COLUMN_INPUT_IDS.forEach((id) => {
        payload[id] = String($(id)?.value || '').trim();
      });
      localStorage.setItem(SORT_IMPORT_COLUMNS_KEY, JSON.stringify(payload));
    };

    const loadSavedColumns = () => {
      try {
        const raw = localStorage.getItem(SORT_IMPORT_COLUMNS_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        COLUMN_INPUT_IDS.forEach((id) => {
          if (saved[id] !== undefined && $(id)) $(id).value = saved[id];
        });
      } catch (e) {
        console.warn('[sort-import] failed to load saved columns', e);
      }
    };

    loadSavedColumns();
    let masterEntries = [];
    const loadMaster = async () => {
      masterEntries = await mgr.getDestinationMaster();
      $('masterEmptyNotice').hidden = masterEntries.length > 0;
      $('importBtn').disabled = masterEntries.length === 0;
    };

    $('saveColumnSettingsBtn')?.addEventListener('click', () => {
      try {
        saveColumns();
        setMessage('列設定を保存しました');
      } catch (e) {
        setMessage(`列設定の保存に失敗しました: ${e.message}`, 'var(--danger)');
      }
    });

    $('clearColumnSettingsBtn')?.addEventListener('click', () => {
      try {
        localStorage.removeItem(SORT_IMPORT_COLUMNS_KEY);
        COLUMN_INPUT_IDS.forEach((id) => { if ($(id)) $(id).value = ''; });
        setMessage('列設定をクリアしました');
      } catch (e) {
        setMessage(`列設定のクリアに失敗しました: ${e.message}`, 'var(--danger)');
      }
    });

    const readRequiredColumn = (id, label) => {
      const raw = String($(id).value || '').trim();
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) throw new Error(`${label}を指定してください（1以上の整数）`);
      return n - 1;
    };
    const readOptionalColumn = (id) => {
      const raw = String($(id).value || '').trim();
      if (!raw) return null;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) throw new Error('任意列は1以上の整数で指定してください');
      return n - 1;
    };

    const parseCsvText = (text) => {
      const rows = [];
      let row = [];
      let cell = '';
      let inQuotes = false;
      const src = String(text || '').replace(/^\uFEFF/, '');
      for (let i = 0; i < src.length; i += 1) {
        const c = src[i];
        const n = src[i + 1];
        if (c === '"') {
          if (inQuotes && n === '"') { cell += '"'; i += 1; } else { inQuotes = !inQuotes; }
        } else if (c === ',' && !inQuotes) {
          row.push(cell); cell = '';
        } else if ((c === '\n' || c === '\r') && !inQuotes) {
          if (c === '\r' && n === '\n') i += 1;
          row.push(cell); rows.push(row); row = []; cell = '';
        } else {
          cell += c;
        }
      }
      if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
      return rows;
    };

    const readRows = async (file) => {
      const name = (file?.name || '').toLowerCase();
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const buf = await file.arrayBuffer();
        if (!window.XLSX) { throw new Error('Excel取込ライブラリを読み込めませんでした。ネットワーク環境を確認するか、CSV形式で取り込んでください。'); }
        const wb = XLSX.read(buf, { type: 'array' });
        return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      }
      const buf = await file.arrayBuffer();
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch (_) {
        text = new TextDecoder('shift_jis', { fatal: false }).decode(buf);
      }
      return parseCsvText(text);
    };

    $('importBtn').onclick = async () => {
      try {
        msg.textContent = '';
        preview.textContent = '';
        warningsPreview.textContent = '警告はありません';
        const file = $('csvFile').files[0];
        if (!file) throw new Error('CSV/Excelファイルを選択してください');

        const cols = {
          jan: readRequiredColumn('colJan', 'バーコード列'),
          dest: readRequiredColumn('colDest', '仕分け先名列'),
          qty: readRequiredColumn('colQty', '数量列'),
          label: readOptionalColumn('colLabel'),
          dcode: readRequiredColumn('colDestCode', '仕分け先コード列')
        };

        const rows = await readRows(file);
        const warnings = [];
        const errors = [];
        const destinations = {};
        const items = {};
        await loadMaster();
        if (!masterEntries.length) throw new Error('仕分け先マスターが登録されていません');
        const masterByCode = Object.fromEntries(masterEntries.map((v) => [v.destinationCode, v]));
        const usedCodes = new Set();
        const missing = new Map();
        const disabled = new Map();

        for (let i = 1; i < rows.length; i += 1) {
          const r = rows[i] || [];
          const rowErrors = [];
          const jan = String(r[cols.jan] || '').trim();
          const destinationName = String(r[cols.dest] || '').trim();
          const qtyRaw = String(r[cols.qty] || '').trim();
          const qty = Number(qtyRaw);
          const productLabel = cols.label === null ? '' : String(r[cols.label] || '').trim();
          const destinationCode = cols.dcode === null ? '' : String(r[cols.dcode] || '').trim();

          if (!jan) rowErrors.push(`${i + 1}行目: バーコード空欄`);
          if (!destinationName) rowErrors.push(`${i + 1}行目: 仕分け先名空欄`);
          if (!destinationCode) rowErrors.push(`${i + 1}行目: 仕分け先コード空欄`);
          if (!Number.isFinite(qty)) rowErrors.push(`${i + 1}行目: 数量が数値でない`);
          if (qty < 0) rowErrors.push(`${i + 1}行目: 数量がマイナス`);
          if (rowErrors.length) { errors.push(...rowErrors); continue; }

          if (cols.label !== null && !productLabel) warnings.push(`${i + 1}行目: 商品表示名空欄`);
          if (qty === 0) warnings.push(`${i + 1}行目: 数量0`);
          if (qty <= 0) continue;

          const master = masterByCode[destinationCode];
          if (!master) { missing.set(destinationCode, destinationName); continue; }
          if (!master.enabled) { disabled.set(destinationCode, master.destinationName); continue; }
          if (master.destinationName !== destinationName) warnings.push(`${destinationCode}: 入力「${destinationName}」／マスター「${master.destinationName}」— マスター登録名を使用します`);
          const sortSlotId = `sortSlot${String(master.slotNo).padStart(3, '0')}`;
          const dest = { sortSlotId, destinationCode, destinationName: master.destinationName, displayOrder: master.slotNo, slotNo: master.slotNo };
          destinations[destinationCode] = dest;
          usedCodes.add(destinationCode);

          const itemKey = encodeURIComponent(jan);
          if (!items[itemKey]) {
            items[itemKey] = {
              itemKey, jan, productLabel: '', firstNonEmptyProductLabel: null, seenLabels: [], totalQty: 0, status: 'unstarted', allocations: {}
            };
          }
          const item = items[itemKey];
          if (productLabel) {
            if (!item.firstNonEmptyProductLabel) item.firstNonEmptyProductLabel = productLabel;
            if (!item.seenLabels.includes(productLabel)) item.seenLabels.push(productLabel);
          }
          item.totalQty += qty;
          if (!item.allocations[dest.sortSlotId]) {
            item.allocations[dest.sortSlotId] = {
              sortSlotId: dest.sortSlotId, destinationCode, destinationName: dest.destinationName, requiredQty: 0, status: 'required',
              doneAt: null, doneByDeviceId: null, cancelCount: 0, lastUpdatedAt: null
            };
          }
          item.allocations[dest.sortSlotId].requiredQty += qty;
        }

        if (errors.length) throw new Error(errors.join('\n'));
        if (missing.size) throw new Error(`仕分け先マスターに未登録のコードがあります。\n${[...missing].map(([c,n]) => `${c} ${n}`).join('\n')}\nマスターへ登録してから再度取込してください。`);
        if (disabled.size) throw new Error(`無効化されている仕分け先が投入データに含まれています。\n${[...disabled].map(([c,n]) => `${c} ${n}`).join('\n')}\n仕分け先マスターを確認してください。`);
        Object.values(items).forEach((item) => {
          if (item.seenLabels.length > 1) warnings.push(`JAN ${item.jan}: 同一JANに複数の商品表示名が存在`);
          item.productLabel = item.firstNonEmptyProductLabel || '';
          delete item.firstNonEmptyProductLabel;
          delete item.seenLabels;
        });

        const destinationMap = {};
        masterEntries.filter((v) => v.enabled).forEach((v) => {
          const sortSlotId = `sortSlot${String(v.slotNo).padStart(3, '0')}`;
          destinationMap[sortSlotId] = { sortSlotId, destinationCode: v.destinationCode, destinationName: v.destinationName, displayOrder: v.slotNo, slotNo: v.slotNo };
        });
        const batchName = file.name;
        const totalQty = Object.values(items).reduce((a, b) => a + b.totalQty, 0);
        // 全検証とプレビュー生成が完了するまで、稼働中バッチには一切触れない。
        preview.textContent = `仕分け先照合結果\nマスター登録：${destinationMap ? Object.keys(destinationMap).length : 0}件\n今回対象：${usedCodes.size}件\n今回投入なし：${Object.keys(destinationMap).length - usedCodes.size}件\n未登録：0件`;
        const activeBatch = await mgr.getActiveBatch();
        if (activeBatch && !confirm('現在の卸仕分けバッチがあります。検証済みの新しいバッチへ切り替えますか？')) return;
        await mgr.replaceActiveBatch({
          batchName, sourceFileName: file.name,
          destinationCount: Object.keys(destinationMap).length,
          itemCount: Object.keys(items).length,
          totalQty,
          destinations: destinationMap,
          items
        });
        saveColumns();

        const visibleWarnings = warnings.slice(0, 20);
        const hiddenWarningCount = warnings.length - visibleWarnings.length;
        warningsPreview.textContent = warnings.length
          ? `${visibleWarnings.join('\n')}${hiddenWarningCount > 0 ? `\nほか${hiddenWarningCount}件` : ''}`
          : '警告はありません';
        preview.textContent = `バッチ名: ${batchName}\nSKU数: ${Object.keys(items).length}\n総数量: ${totalQty}\n\n仕分け先照合結果\nマスター登録：${Object.keys(destinationMap).length}件\n今回対象：${usedCodes.size}件\n今回投入なし：${Object.keys(destinationMap).length - usedCodes.size}件\n未登録：0件\n${Object.values(destinationMap).sort((a,b) => a.displayOrder-b.displayOrder).map((d) => `No.${String(d.displayOrder).padStart(3, '0')} ${d.destinationName}　${usedCodes.has(d.destinationCode) ? '対象' : '今回投入なし'}`).join('\n')}`;
        setMessage('取込完了（列設定を保存しました）');
      } catch (e) {
        setMessage(e.message, 'var(--danger)');
      }
    };

    $('resetBtn').onclick = async () => {
      if (!confirm('現在の卸仕分けバッチと実績状態を削除します。\n既存の投入・ピッキングデータには影響しません。\nよろしいですか？')) return;
      await mgr.resetAll();
      alert('卸仕分けデータをリセットしました');
    };
    const waitForAuth = setInterval(() => { if (mgr.user) { clearInterval(waitForAuth); loadMaster().catch((e) => setMessage(e.message, 'var(--danger)')); } }, 100);
  });
})();
