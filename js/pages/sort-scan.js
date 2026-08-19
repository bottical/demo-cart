(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    let snapshot = null;
    const mgr = new SortStateManager((s) => { snapshot = s; render(); focus(); }, (u) => { if (!u) location.href = 'index.html'; });

    const focus = () => setTimeout(() => $('scanInput').focus(), 20);
    const csvEscape = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      const escaped = s.replace(/"/g, '""');
      return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
    };
    const escapeHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const getAllocationStatusDisplay = (status) => {
      if (status === 'done') return { label: '✓ 完了', className: 'is-done' };
      if (status === 'required') return { label: '未完了', className: 'is-required' };
      return { label: '状態不明', className: 'is-unknown' };
    };

    const summarize = (item, batch) => {
      const allocs = Object.values(item.allocations || {});
      const done = allocs.filter((a) => a.status === 'done').length;
      const undone = allocs.filter((a) => a.status !== 'done').map((u) => {
        const order = batch.destinations?.[u.sortSlotId]?.displayOrder || 0;
        return `仕分け先 No.${String(order).padStart(3, '0')} ${u.destinationName} ${u.requiredQty}個`;
      });
      return { jan: item.jan, productLabel: item.productLabel || '商品表示名未設定', done, total: allocs.length, undone };
    };

    const render = () => {
      const b = snapshot?.batch;
      const st = snapshot?.sortState || {};
      const prev = st.previousSkuSummary;
      if (prev) {
        const isDone = prev.done === prev.total;
        const undone = prev.undone || [];
        $('previous').innerHTML = `
          <div>前回SKU: ${escapeHtml(prev.productLabel)} / JAN:${escapeHtml(prev.jan)}</div>
          <div class="sort-previous-status">
            <span class="sort-status-badge ${isDone ? 'is-done' : 'is-required'}">${isDone ? '✓ 完了' : '未完了'}</span>
            <strong>${escapeHtml(prev.done)} / ${escapeHtml(prev.total)} 完了</strong>
          </div>
          <div class="sort-previous-undone"><strong>未完了：</strong>${isDone ? 'なし' : `<ul>${undone.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>`}</div>`;
      } else {
        $('previous').textContent = '-';
      }

      const activeItemKey = st.activeItemKey;
      if (!activeItemKey || !b?.items?.[activeItemKey]) { $('current').innerHTML = 'スキャン待機中'; return; }
      const item = b.items[activeItemKey];
      const rows = Object.values(item.allocations || {}).map((a) => {
        const order = b.destinations?.[a.sortSlotId]?.displayOrder || 0;
        const statusDisplay = getAllocationStatusDisplay(a.status);
        return `<tr><td>No.${String(order).padStart(3, '0')}</td><td>${escapeHtml(a.destinationName)}</td><td>${a.requiredQty}個</td><td><span class="sort-status-badge ${statusDisplay.className}">${statusDisplay.label}</span></td></tr>`;
      }).join('');
      $('current').innerHTML = `<div><strong>${escapeHtml(item.productLabel || '商品表示名未設定')}</strong></div><div>JAN: ${escapeHtml(item.jan)}</div><div>総数量: ${item.totalQty}</div><table style='width:100%;margin-top:.5rem;'><thead><tr><th>仕分け先</th><th>卸先名</th><th>数量</th><th>状態</th></tr></thead><tbody>${rows}</tbody></table>`;
    };

    $('scanInput').addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const jan = e.target.value.trim();
      e.target.value = '';

      const b = await mgr.getActiveBatch();
      if (!b) { $('err').textContent = '先に卸仕分けCSVを取り込んでください'; focus(); return; }
      const itemKey = encodeURIComponent(jan);
      if (!b.items?.[itemKey]) { $('err').textContent = '未登録JANです'; window.AudioManager?.playErrorSound?.(); focus(); return; }

      const st = snapshot?.sortState || {};
      const prevKey = st.activeItemKey;
      const prev = prevKey && b.items?.[prevKey] ? summarize(b.items[prevKey], b) : null;
      const allocs = Object.values(b.items[itemKey].allocations || {}).filter((x) => (x.requiredQty || 0) > 0);
      const done = allocs.filter((x) => x.status === 'done').length;
      const nextStatus = done === allocs.length ? 'completed' : (done > 0 ? 'partial' : 'active');
      await mgr.batchDoc(b.id).update({ [`items.${itemKey}.status`]: nextStatus, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      await mgr.setActiveSku(itemKey, jan, prev);
      $('err').textContent = '';
      focus();
    });

    $('dlBtn').onclick = async () => {
      const b = await mgr.getActiveBatch();
      if (!b) { $('err').textContent = '先に卸仕分けCSVを取り込んでください'; focus(); return; }
      const lines = ['batchName,jan,productLabel,destinationName,requiredQty,status,doneAt'];
      Object.values(b.items || {}).forEach((it) => Object.values(it.allocations || {}).forEach((a) => {
        if (a.requiredQty > 0) lines.push([b.batchName, it.jan, it.productLabel || '商品表示名未設定', a.destinationName, a.requiredQty, a.status, a.doneAt || ''].map(csvEscape).join(','));
      }));
      const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${b.batchName || 'sort'}-result.csv`;
      a.click();
      focus();
    };

    $('resetBtn').onclick = async () => {
      if (!confirm('現在の卸仕分けバッチと実績状態を削除します。\n既存の投入・ピッキングデータには影響しません。\nよろしいですか？')) return;
      await mgr.resetAll();
      alert('リセットしました');
      focus();
    };

    focus();
  });
})();
