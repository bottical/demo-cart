(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const SORT_COLORS = [
      '#2563eb',
      '#dc2626',
      '#16a34a',
      '#f59e0b',
      '#7c3aed',
      '#0891b2',
      '#db2777',
      '#65a30d'
    ];
    const deviceId = localStorage.getItem('sortDeviceId') || crypto.randomUUID();
    localStorage.setItem('sortDeviceId', deviceId);

    let snapshot = null;
    const mgr = new SortStateManager((s) => { snapshot = s; render(); }, (u) => { if (!u) location.href = 'index.html'; });

    const cloneSnapshot = (value) => {
      if (!value) return value;
      if (typeof structuredClone === 'function') {
        try {
          return structuredClone(value);
        } catch (_) {
          // Firestore Timestamp 等が clone できない環境では JSON で十分な表示用スナップショットへ退避する。
        }
      }
      return JSON.parse(JSON.stringify(value));
    };

    const updateLocalAllocation = (itemKey, sortSlotId, toDone) => {
      if (!snapshot?.batch?.items?.[itemKey]?.allocations?.[sortSlotId]) return;

      snapshot = cloneSnapshot(snapshot);
      const item = snapshot.batch.items[itemKey];
      const allocation = item.allocations[sortSlotId];
      const wasDone = allocation.status === 'done';
      allocation.status = toDone ? 'done' : 'required';
      allocation.doneByDeviceId = toDone ? deviceId : null;
      allocation.doneAt = toDone ? new Date() : null;
      allocation.lastUpdatedAt = new Date();
      allocation.cancelCount = toDone ? (allocation.cancelCount || 0) : ((allocation.cancelCount || 0) + (wasDone ? 1 : 0));

      const requiredAllocations = Object.values(item.allocations || {}).filter((v) => (v.requiredQty || 0) > 0);
      const doneCount = requiredAllocations.filter((v) => v.status === 'done').length;
      item.status = doneCount === 0 ? 'active' : doneCount === requiredAllocations.length ? 'completed' : 'partial';
      snapshot.batch.updatedAt = new Date();
      render();
    };

    const escapeHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const getSortColor = (displayOrder) => SORT_COLORS[(Math.max(1, Number(displayOrder || 1)) - 1) % SORT_COLORS.length];
    const getDisplayScale = () => localStorage.getItem('sortDisplayScale') || 'M';
    const getLayoutDirection = () => localStorage.getItem('sortLayoutDirection') || 'horizontal';

    $('toggleCfg').onclick = () => {
      const isOpen = $('cfgWrap').classList.toggle('open');
      document.body.classList.toggle('is-config-open', isOpen);
      $('toggleCfg').setAttribute('aria-expanded', String(isOpen));
    };
    $('start').value = localStorage.getItem('sortSlotStartIndex') || 1;
    $('count').value = localStorage.getItem('sortSlotCount') || 4;
    $('scale').value = getDisplayScale();
    $('layoutDirection').value = getLayoutDirection();
    document.body.dataset.sortScale = getDisplayScale().toLowerCase();
    document.body.dataset.sortLayout = getLayoutDirection();

    $('save').onclick = () => {
      localStorage.setItem('sortSlotStartIndex', $('start').value);
      localStorage.setItem('sortSlotCount', $('count').value);
      localStorage.setItem('sortDisplayScale', $('scale').value);
      localStorage.setItem('sortLayoutDirection', $('layoutDirection').value);
      location.reload();
    };

    async function updateAllocation(batchId, itemKey, sortSlotId, toDone) {
      const item = snapshot?.batch?.items?.[itemKey];
      if (!item) throw new Error('SKUが見つかりません');
      const allocation = item.allocations?.[sortSlotId];
      if (!allocation) throw new Error('仕分け先が見つかりません');

      const values = Object.values(item.allocations || {}).filter((v) => (v.requiredQty || 0) > 0);
      const simulated = values.map((v) => (
        v.sortSlotId === sortSlotId ? { ...v, status: toDone ? 'done' : 'required' } : v
      ));
      const doneCount = simulated.filter((v) => v.status === 'done').length;
      const nextItemStatus = doneCount === 0 ? 'active' : doneCount === simulated.length ? 'completed' : 'partial';
      const serverTimestamp = firebase.firestore.FieldValue.serverTimestamp();
      const base = `items.${itemKey}.allocations.${sortSlotId}`;
      const updatePayload = {
        [`${base}.status`]: toDone ? 'done' : 'required',
        [`${base}.doneByDeviceId`]: toDone ? deviceId : null,
        [`${base}.doneAt`]: toDone ? serverTimestamp : null,
        [`${base}.lastUpdatedAt`]: serverTimestamp,
        [`items.${itemKey}.status`]: nextItemStatus,
        updatedAt: serverTimestamp
      };

      if (!toDone) {
        updatePayload[`${base}.cancelCount`] = firebase.firestore.FieldValue.increment(1);
      }

      await mgr.batchDoc(batchId).update(updatePayload);
    }

    function renderCardBase(card, dest) {
      card.style.setProperty('--sort-pick-color', getSortColor(dest.displayOrder));
      card.innerHTML = `
        <div class="sort-slot-no">仕分け先 No.${String(dest.displayOrder).padStart(3, '0')}</div>
        <div class="sort-slot-destination">${escapeHtml(dest.destinationName)}</div>
      `;
    }

    function render() {
      const b = snapshot?.batch;
      const activeItemKey = snapshot?.sortState?.activeItemKey;
      const item = activeItemKey && b?.items?.[activeItemKey] ? b.items[activeItemKey] : null;
      $('sku').textContent = item ? `${item.productLabel || '商品表示名未設定'} / JAN:${item.jan}` : 'スキャン待機中';

      const cards = $('cards');
      cards.innerHTML = '';
      cards.classList.remove('is-single');
      if (!b?.destinations) {
        cards.innerHTML = '<div class="sort-slot-empty">バッチ未作成</div>';
        return;
      }

      const start = Number(localStorage.getItem('sortSlotStartIndex') || 1);
      const count = Number(localStorage.getItem('sortSlotCount') || 4);
      const selected = Object.values(b.destinations).sort((a, c) => a.displayOrder - c.displayOrder).slice(start - 1, start - 1 + count);
      cards.classList.toggle('is-single', selected.length === 1);

      selected.forEach((dest) => {
        const itemKey = item?.itemKey;
        const alloc = item?.allocations?.[dest.sortSlotId];
        const isDone = alloc?.status === 'done';
        const card = document.createElement('div');
        card.className = `sort-slot-card ${!alloc ? 'is-none' : isDone ? 'is-done' : 'is-required'}`;
        renderCardBase(card, dest);

        if (!alloc) {
          card.innerHTML += '<div class="sort-slot-none-label">今回投入なし</div>';
        } else if (isDone) {
          card.innerHTML += '<div class="sort-slot-done-label">完了</div><div class="sort-slot-hint">長押しで取消</div><div class="sort-long-progress"><span></span></div>';
        } else {
          card.innerHTML += `
            <div class="sort-slot-product">${escapeHtml(item.productLabel || '商品表示名未設定')}</div>
            <div class="sort-slot-jan">JAN: ${escapeHtml(item.jan)}</div>
            <div class="sort-slot-qty">${escapeHtml(alloc.requiredQty)}</div>
          `;
        }

        if (alloc?.status === 'required') {
          card.onclick = async () => {
            const previousSnapshot = cloneSnapshot(snapshot);
            try {
              updateLocalAllocation(itemKey, dest.sortSlotId, true);
              await updateAllocation(b.id, itemKey, dest.sortSlotId, true);
              updateLocalAllocation(itemKey, dest.sortSlotId, true);
              $('err').textContent = '';
            } catch (e) {
              snapshot = previousSnapshot;
              render();
              $('err').textContent = e.message;
            }
          };
        }

        if (isDone) {
          let t = null;
          let raf = null;
          const bar = card.querySelector('.sort-long-progress > span');
          const clear = () => { clearTimeout(t); if (raf) cancelAnimationFrame(raf); if (bar) bar.style.width = '0%'; };
          card.onpointerdown = () => {
            const startedAt = performance.now();
            const tick = () => {
              const p = Math.min(1, (performance.now() - startedAt) / 900);
              if (bar) bar.style.width = `${p * 100}%`;
              if (p < 1) raf = requestAnimationFrame(tick);
            };
            raf = requestAnimationFrame(tick);
            t = setTimeout(async () => {
              const previousSnapshot = cloneSnapshot(snapshot);
              try {
                updateLocalAllocation(itemKey, dest.sortSlotId, false);
                await updateAllocation(b.id, itemKey, dest.sortSlotId, false);
                updateLocalAllocation(itemKey, dest.sortSlotId, false);
                $('err').textContent = '';
              } catch (e) {
                snapshot = previousSnapshot;
                render();
                $('err').textContent = e.message;
              }
              clear();
            }, 900);
          };
          card.onpointerup = clear;
          card.onpointerleave = clear;
          card.onpointercancel = clear;
        }

        cards.appendChild(card);
      });
    }
  });
})();
