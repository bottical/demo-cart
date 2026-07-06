// Inject Mode Logic (Non-module)
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const bayGrid = document.getElementById('bayGrid');
        const scanInput = document.getElementById('scanInput');
        const scanMsg = document.getElementById('scanMsg');
        const loadCsvBtn = document.getElementById('loadCsvBtn');
        const slotCsvFileInput = document.getElementById('slotCsvFile');
        const importSlotLayoutBtn = document.getElementById('importSlotLayoutBtn');
        const exportSlotLayoutBtn = document.getElementById('exportSlotLayoutBtn');
        const slotImportHints = document.getElementById('slotImportHints');
        const slotImportPreviewModal = document.getElementById('slotImportPreviewModal');
        const slotImportConfirmModal = document.getElementById('slotImportConfirmModal');
        const slotImportPreviewSummary = document.getElementById('slotImportPreviewSummary');
        const slotImportConfirmSummary = document.getElementById('slotImportConfirmSummary');
        const slotImportPreviewOutOfScope = document.getElementById('slotImportPreviewOutOfScope');
        const slotImportPreviewDuplicateJan = document.getElementById('slotImportPreviewDuplicateJan');
        const slotImportPreviewInvalidRows = document.getElementById('slotImportPreviewInvalidRows');
        const instPanel = document.getElementById('instructionPanel');
        const sessionDisplay = document.getElementById('sessionDisplay');
        let hasRequestedInjectModeSync = false;
        let highlightedSlotKey = null;
        let highlightTimer = null;
        const HIGHLIGHT_MS = 3000;
        let pendingSlotImportPreview = null;


        const perf = window.__shelflowPerf;
        let renderCountWindow = { startedAt: performance.now(), count: 0, lastCountPerSec: 0 };
        const countRender = (pageName) => {
            const now = performance.now();
            renderCountWindow.count += 1;
            if (now - renderCountWindow.startedAt > 1000) {
                const count = renderCountWindow.count;
                renderCountWindow.lastCountPerSec = count;
                perf?.mark(`${pageName}.render.rate`, { countPerSec: count });
                if (count >= 5) console.warn(`[${pageName}] high render rate`, count);
                renderCountWindow = { startedAt: now, count: 0, lastCountPerSec: count };
            }
        };

        const stateMgr = new StateManager(
            (state) => {
                if (!state) return;

                if (state.mode === 'INJECT') {
                    hasRequestedInjectModeSync = true;
                } else if (stateMgr.user && !hasRequestedInjectModeSync) {
                    hasRequestedInjectModeSync = true;
                    stateMgr.update({ mode: 'INJECT' }).catch((e) => {
                        console.error('inject mode への切り替えに失敗しました:', e);
                        hasRequestedInjectModeSync = false;
                    });
                }

                render(state);
                updateUIState(state);
                updateUserSelectorUI();
            },
            (user) => {
                if (user) {
                    sessionDisplay.textContent = `USER: ${user.email}`;
                } else {
                    window.location.href = 'index.html';
                }
            }
        );

        const cancelInjectBtn = document.getElementById('cancelInjectBtn');
        if (cancelInjectBtn) {
            cancelInjectBtn.addEventListener('click', async () => {
                try {
                    await stateMgr.cancelInjectPending();
                    scanInput.disabled = false;
                    scanInput.parentElement.style.opacity = '1';
                    scanInput.value = '';
                    setTimeout(() => scanInput.focus(), 50);
                    scanMsg.classList.add('hidden');
                } catch (e) {
                    console.error('投入キャンセルに失敗しました:', e);
                    AudioManager.playErrorSound();
                    showMessage('❌ キャンセルに失敗しました。通信状態をご確認ください。', 'error');
                }
            });
        }

        const updateUserSelectorUI = () => {
            const userSelect = document.getElementById('userSelect');
            if (userSelect) {
                userSelect.value = stateMgr.currentUserId;
                const uIdx = stateMgr.currentUserId.slice(-1);
                userSelect.style.borderColor = `var(--user${uIdx})`;
                userSelect.style.color = `var(--user${uIdx})`;
                userSelect.style.backgroundColor = `rgba(255, 255, 255, 0.05)`;
            }
        };

        const userSelect = document.getElementById('userSelect');
        if (userSelect) {
            userSelect.addEventListener('change', (e) => {
                stateMgr.setCurrentUser(e.target.value);
            });
        }

        const navGuard = window.NavigationGuard.createNavigationHelpers({
            stateMgr,
            audioManager: AudioManager,
            onCancelError: () => {
                showMessage('❌ 作業のキャンセルに失敗したため、ページ移動を中止しました。通信状態をご確認ください。', 'error');
            }
        });
        const guardedNavigate = navGuard.guardedNavigate;
        navGuard.installBeforeUnloadGuard();

        const clearLocalInjectUiState = () => {
            highlightedSlotKey = null;
            if (highlightTimer) {
                clearTimeout(highlightTimer);
                highlightTimer = null;
            }
            stateMgr.localUiState.optimisticSlots = {};
            stateMgr.localUiState.cancelledInjectRequestIds = {};
            stateMgr.clearLocalInjectPending();
        };


        const normalizeJan = (jan) => {
            return stateMgr.normalizeJanValue(jan);
        };
        const normalizeText = (value) => String(value ?? '').replace(/^[\s　]+|[\s　]+$/g, '');
        const buildProductLabel = ({ label, productCode, productName }) => {
            const safeLabel = normalizeText(label);
            const safeCode = normalizeText(productCode);
            const safeName = normalizeText(productName);
            if (safeLabel) return safeLabel;
            if (safeCode && safeName) return `${safeCode} / ${safeName}`;
            if (safeCode) return safeCode;
            if (safeName) return safeName;
            return '';
        };
        const getProductInfo = (state, jan) => state?.productInfo?.[jan] || {};
        let lastAcceptedJan = null;
        let lastAcceptedAt = 0;

        const highlightDuplicateSlot = (slotKey) => {
            highlightedSlotKey = slotKey || null;
            render(stateMgr.state);

            if (highlightTimer) {
                clearTimeout(highlightTimer);
            }
            highlightTimer = setTimeout(() => {
                highlightedSlotKey = null;
                render(stateMgr.state);
            }, HIGHLIGHT_MS);
        };

        function parseCsvLine(line) {
            const result = [];
            let current = '';
            let inQuotes = false;

            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const next = line[i + 1];

                if (char === '"') {
                    if (inQuotes && next === '"') {
                        current += '"';
                        i++;
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if (char === ',' && !inQuotes) {
                    result.push(current);
                    current = '';
                } else {
                    current += char;
                }
            }

            result.push(current);
            return result.map(v => v.trim());
        }

        const readTableRowsFromFile = (file) => {
            return new Promise((resolve, reject) => {
                const lowerName = (file?.name || '').toLowerCase();
                const isExcel = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');
                const isCsv = lowerName.endsWith('.csv');
                if (!isCsv && !isExcel) {
                    reject(new Error('unsupported'));
                    return;
                }

                const reader = new FileReader();
                reader.onerror = () => reject(new Error('read-failed'));
                reader.onload = (e) => {
                    try {
                        if (isExcel) {
                            if (typeof XLSX === 'undefined') {
                                reject(new Error('xlsx-missing'));
                                return;
                            }
                            const workbook = XLSX.read(e.target.result, { type: 'array' });
                            const firstSheetName = workbook.SheetNames[0];
                            if (!firstSheetName) {
                                reject(new Error('sheet-missing'));
                                return;
                            }
                            const firstSheet = workbook.Sheets[firstSheetName];
                            const rows = XLSX.utils.sheet_to_json(firstSheet, {
                                header: 1,
                                raw: false,
                                defval: ''
                            });
                            resolve(rows);
                            return;
                        }
                        const text = String(e.target.result || '');
                        const rows = text.split(/\r?\n/).filter(x => x.trim()).map(parseCsvLine);
                        resolve(rows);
                    } catch (err) {
                        reject(err);
                    }
                };
                if (isExcel) reader.readAsArrayBuffer(file);
                else reader.readAsText(file);
            });
        };

        const normalizeHeaderKey = (value) => {
            return String(value || '')
                .replace(/\s+/g, '')
                .replace(/[０-９]/g, (v) => String.fromCharCode(v.charCodeAt(0) - 0xFEE0))
                .toLowerCase();
        };

        const detectSlotImportColumnIndex = (headerRow) => {
            const headers = (headerRow || []).map(normalizeHeaderKey);
            const findIndex = (candidates) => headers.findIndex((h) => candidates.includes(h));

            const bayCol = findIndex([
                '間口no', '間口番号', '間口',
                'bay_no', 'bayno', 'bay'
            ]);

            const logicalCol = findIndex([
                '論理間口no', '論理間口番号', '論理間口',
                'logical_slot_no', 'logicalslotno', 'logicalslot'
            ]);

            const janCol = findIndex([
                'jan', 'jancode', 'janコード'
            ]);

            if (bayCol < 0 || logicalCol < 0 || janCol < 0) return null;
            return { bayCol, logicalCol, janCol };
        };

        const hasPickListLoaded = (state) => {
            const injectList = state?.injectList || {};
            return Object.keys(injectList).length > 0;
        };

        const toInt = (value) => {
            const n = parseInt(String(value || '').trim(), 10);
            return Number.isInteger(n) ? n : NaN;
        };

        const buildComparisonSummary = (state, importedSlots) => {
            const currentSlots = getMergedSlots(state);
            const currentAssignedJanSet = new Set();
            Object.values(currentSlots).forEach((slot) => {
                const skus = slot?.skus || (slot?.sku ? [slot.sku] : []);
                skus.forEach((jan) => currentAssignedJanSet.add(String(jan)));
            });

            const importedAssignedJanSet = new Set();
            Object.values(importedSlots).forEach((slot) => {
                (slot?.skus || []).forEach((jan) => importedAssignedJanSet.add(String(jan)));
            });

            const intersection = new Set([...currentAssignedJanSet].filter((jan) => importedAssignedJanSet.has(jan)));
            const newOnly = new Set([...importedAssignedJanSet].filter((jan) => !currentAssignedJanSet.has(jan)));
            const removedOnly = new Set([...currentAssignedJanSet].filter((jan) => !importedAssignedJanSet.has(jan)));

            return {
                currentAssignedJanSet,
                importedAssignedJanSet,
                intersection,
                newOnly,
                removedOnly
            };
        };

        const renderSummaryGrid = (container, items) => {
            container.innerHTML = items.map((item) => `
                <div class="import-summary-item">
                    <div class="import-summary-item-label">${item.label}</div>
                    <div class="import-summary-item-value">${item.value}</div>
                </div>
            `).join('');
        };

        const renderDetailList = (container, rows) => {
            if (!rows || rows.length === 0) {
                container.innerHTML = '（なし）';
                return;
            }
            container.innerHTML = rows.map((row) => `<div>${row}</div>`).join('');
        };

        const ensureNoInProgressWorkForSlotImport = async () => {
            const work = stateMgr.getInProgressWorkForCurrentUser(stateMgr.state);
            if (!work.hasInjectInProgress && !work.hasPickInProgress) return true;
            const proceed = await navGuard.showNavigationConfirmModal(
                window.NavigationGuard.buildNavigationGuardMessage(work)
            );
            if (!proceed) return false;
            try {
                await stateMgr.cancelCurrentWorkForNavigation();
                clearLocalInjectUiState();
                return true;
            } catch (error) {
                console.error('間口配置インポート前の作業キャンセルに失敗しました:', error);
                AudioManager.playErrorSound();
                showMessage('❌ 作業のキャンセルに失敗しました。通信状態をご確認ください。', 'error');
                return false;
            }
        };

        const getMergedSlots = (state) => {
            const baseSlots = { ...(state.slots || {}) };
            const optimisticSlots = stateMgr.localUiState.optimisticSlots || {};
            Object.entries(optimisticSlots).forEach(([slotKey, optimisticSlot]) => {
                if (!optimisticSlot) return;
                baseSlots[slotKey] = { skus: [...(optimisticSlot.skus || [])] };
            });
            return baseSlots;
        };

        const getMergedJanIndex = (state) => {
            const base = { ...(state.janIndex || {}) };
            const optimisticSlots = stateMgr.localUiState.optimisticSlots || {};
            Object.entries(optimisticSlots).forEach(([slotKey, slot]) => {
                const skus = slot?.skus || [];
                skus.forEach((jan) => {
                    base[jan] = slotKey;
                });
            });
            return base;
        };

        const isJanAssignedSomewhere = (state, jan) => {
            if (!jan) return false;
            const mergedSlots = getMergedSlots(state);
            return Object.values(mergedSlots).some((slot) => {
                const skus = slot?.skus || (slot?.sku ? [slot.sku] : []);
                return skus.includes(jan);
            });
        };

        let lastIsWaiting = false;
        let lastWaitingJan = null;
        let lastWaitingJanWasAssigned = false;

        const updateUIState = (state) => {
            const pending = stateMgr.getEffectiveInjectPendingForCurrentUser(state);
            const currentUserState = state.userStates?.[stateMgr.currentUserId] || {};
            console.debug('[inject:updateUIState]', {
                remotePending: currentUserState.injectPending || null,
                localPending: stateMgr.localUiState.injectPendingPreview || null,
                effectivePending: pending,
                cancelledMap: stateMgr.localUiState.cancelledInjectRequestIds || {}
            });
            const isWaiting = pending && pending.status === "WAITING_SLOT";

            if (isWaiting) {
                lastWaitingJan = pending.jan || null;
                lastWaitingJanWasAssigned = isJanAssignedSomewhere(state, pending.jan);
                instPanel.classList.remove('hidden');
                scanInput.disabled = true;
                scanInput.value = pending.jan;
                scanInput.parentElement.style.opacity = '0.5';

                const totalQty = state.injectList?.[pending.jan] || 0;
                const productLabel = normalizeText(getProductInfo(state, pending.jan).productLabel);
                const dashProductBlock = document.getElementById('dashProductBlock');
                const dashProductLabel = document.getElementById('dashProductLabel');
                if (productLabel) {
                    dashProductLabel.textContent = productLabel;
                    dashProductBlock.classList.remove('hidden');
                } else {
                    dashProductLabel.textContent = '';
                    dashProductBlock.classList.add('hidden');
                }
                document.getElementById('dashJan').textContent = pending.jan;
                document.getElementById('dashQty').textContent = totalQty;
                scanMsg.classList.add('hidden');
            } else {
                if (lastIsWaiting) {
                    const assignedNow = isJanAssignedSomewhere(state, lastWaitingJan);
                    const success = !lastWaitingJanWasAssigned && assignedNow;
                    if (success) {
                        AudioManager.playStartSound();
                    }
                    scanInput.value = '';
                    setTimeout(() => scanInput.focus(), 100);
                }

                instPanel.classList.add('hidden');
                scanInput.disabled = false;
                scanInput.parentElement.style.opacity = '1';
                if (scanMsg.classList.contains('info')) {
                    scanMsg.classList.add('hidden');
                }
            }
            lastIsWaiting = isWaiting;
            if (!isWaiting) {
                lastWaitingJan = null;
                lastWaitingJanWasAssigned = false;
            }

            const pickLoaded = hasPickListLoaded(state);
            importSlotLayoutBtn.disabled = !pickLoaded;
            slotImportHints.innerHTML = pickLoaded
                ? [
                    '現在の間口配置を全置換します',
                    '既存の配置は上書きされます',
                    '数量は現在のピッキングリストから反映されます'
                ].map((text) => `<p>${text}</p>`).join('')
                : [
                    '先にピッキングリストを読込してください',
                    '数量は現在のピッキングリストから反映されます',
                    'インポート時にファイル内の数量は使用しません'
                ].map((text) => `<p>${text}</p>`).join('');
        };

        const showSlotSkusModal = (b, s, skus, stateMgr) => {
            let overlay = document.getElementById('slotSkusOverlay');
            if (overlay) overlay.remove();

            overlay = document.createElement('div');
            overlay.id = 'slotSkusOverlay';
            overlay.className = 'overlay';
            overlay.style.position = 'fixed';
            overlay.style.inset = '0';
            overlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '1000';

            const modal = document.createElement('div');
            modal.style.background = '#1e293b';
            modal.style.padding = '2rem';
            modal.style.borderRadius = '12px';
            modal.style.minWidth = '300px';
            modal.style.maxWidth = '90%';
            modal.style.color = 'white';

            modal.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                    <h3 style="margin:0;">No.${b}-${s} 投入済みSKU</h3>
                    <button class="btn btn-outline close-btn" style="padding:4px 8px;">✕</button>
                </div>
                <div id="skusList" style="display:flex; flex-direction:column; gap:0.5rem; max-height: 300px; overflow-y:auto; margin-bottom:1.5rem;">
                </div>
            `;

            const listContainer = modal.querySelector('#skusList');
            skus.forEach(jan => {
                const item = document.createElement('div');
                item.style.display = 'flex';
                item.style.justifyContent = 'space-between';
                item.style.alignItems = 'center';
                item.style.background = '#334155';
                item.style.padding = '0.75rem';
                item.style.borderRadius = '6px';
                
                item.innerHTML = `
                    <span style="font-family:monospace; font-weight:700;">${jan}</span>
                    <button class="btn btn-danger remove-sku-btn" data-jan="${jan}" style="padding:0.25rem 0.75rem; font-size:0.8rem;">解除</button>
                `;
                listContainer.appendChild(item);
            });

            if (skus.length === 0) {
                listContainer.innerHTML = '<div style="color:#94a3b8; text-align:center;">（空です）</div>';
            }

            modal.querySelector('.close-btn').onclick = () => overlay.remove();

            modal.querySelectorAll('.remove-sku-btn').forEach(btn => {
                btn.onclick = () => {
                    const targetJan = btn.getAttribute('data-jan');
                    if (confirm(`JAN: ${targetJan}\nこのSKUを未割り当てに戻しますか？`)) {
                        stateMgr.unassignSlot(`${b}-${s}`, targetJan);
                        overlay.remove();
                    }
                };
            });

            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        };

        const render = (state) => {
            const renderStart = performance.now();
            countRender("inject");
            const totalBays = state?.config?.bays || 9;
            const pendingJan = stateMgr.getEffectiveInjectPendingForCurrentUser(state)?.jan || null;
            perf?.mark("inject.render.start", {
                mode: state?.mode || null,
                bays: totalBays,
                slotsCount: Object.keys(state?.slots || {}).length,
                injectListCount: Object.keys(state?.injectList || {}).length,
                pendingJanLast4: String(pendingJan || '').slice(-4) || null,
                optimisticSlotsCount: Object.keys(stateMgr.localUiState.optimisticSlots || {}).length
            });
            try {
            const mergedSlots = getMergedSlots(state);
            bayGrid.innerHTML = '';
            for (let b = 1; b <= totalBays; b++) {
                const splits = state.splits?.[b];
                const isConfigured = splits !== undefined;

                const bayCard = document.createElement('div');
                bayCard.className = 'card bay-card';
                bayCard.innerHTML = `<div style="text-align:center; font-weight:800; color:var(--text-muted); font-size:0.8rem;">No.${b}</div>`;

                const slotContainer = document.createElement('div');
                slotContainer.className = 'slot-container';

                if (!isConfigured) {
                    slotContainer.innerHTML = `<div style="grid-column:span 2; grid-row:span 2; display:flex; align-items:center; justify-content:center; background:#f8fafc; color:#cbd5e1; font-size:0.75rem; border:2px dashed #e2e8f0; border-radius:0.5rem;">スマホ未設定</div>`;
                } else {
                    // Update grid templates dynamically for PC view based on splits (max 6, mapping to portrait layout)
                    if (splits === 1) { slotContainer.style.gridTemplateColumns = '1fr'; slotContainer.style.gridTemplateRows = '1fr'; }
                    else if (splits === 2) { slotContainer.style.gridTemplateColumns = '1fr'; slotContainer.style.gridTemplateRows = '1fr 1fr'; }
                    else if (splits === 3) { slotContainer.style.gridTemplateColumns = '1fr 1fr'; slotContainer.style.gridTemplateRows = '1fr 1fr'; }
                    else if (splits === 4) { slotContainer.style.gridTemplateColumns = '1fr 1fr'; slotContainer.style.gridTemplateRows = '1fr 1fr'; }
                    else if (splits === 5) { slotContainer.style.gridTemplateColumns = '1fr 1fr'; slotContainer.style.gridTemplateRows = '1fr 1fr 1fr'; }
                    else { slotContainer.style.gridTemplateColumns = '1fr 1fr'; slotContainer.style.gridTemplateRows = '1fr 1fr 1fr'; }

                    for (let s = 1; s <= splits; s++) {
                        const slotKey = `${b}-${s}`;
                        const slotData = mergedSlots[slotKey];
                        const slot = document.createElement('div');
                        slot.className = 'slot';

                        // Detailed Grid Placement (Bottom-heavy numbers)
                        if (splits === 2) {
                            if (s === 2) { slot.style.gridRow = '1'; slot.style.gridColumn = '1'; }
                            if (s === 1) { slot.style.gridRow = '2'; slot.style.gridColumn = '1'; }
                        } else if (splits === 3) {
                            if (s === 3) { slot.style.gridRow = '1'; slot.style.gridColumn = '1 / span 2'; }
                            if (s === 1) { slot.style.gridRow = '2'; slot.style.gridColumn = '1'; }
                            if (s === 2) { slot.style.gridRow = '2'; slot.style.gridColumn = '2'; }
                        } else if (splits === 4) {
                            if (s === 3) { slot.style.gridRow = '1'; slot.style.gridColumn = '1'; }
                            if (s === 4) { slot.style.gridRow = '1'; slot.style.gridColumn = '2'; }
                            if (s === 1) { slot.style.gridRow = '2'; slot.style.gridColumn = '1'; }
                            if (s === 2) { slot.style.gridRow = '2'; slot.style.gridColumn = '2'; }
                        } else if (splits === 5) {
                            if (s === 5) { slot.style.gridRow = '1'; slot.style.gridColumn = '1 / span 2'; }
                            if (s === 3) { slot.style.gridRow = '2'; slot.style.gridColumn = '1'; }
                            if (s === 4) { slot.style.gridRow = '2'; slot.style.gridColumn = '2'; }
                            if (s === 1) { slot.style.gridRow = '3'; slot.style.gridColumn = '1'; }
                            if (s === 2) { slot.style.gridRow = '3'; slot.style.gridColumn = '2'; }
                        } else if (splits === 6) {
                            if (s === 5) { slot.style.gridRow = '1'; slot.style.gridColumn = '1'; }
                            if (s === 6) { slot.style.gridRow = '1'; slot.style.gridColumn = '2'; }
                            if (s === 3) { slot.style.gridRow = '2'; slot.style.gridColumn = '1'; }
                            if (s === 4) { slot.style.gridRow = '2'; slot.style.gridColumn = '2'; }
                            if (s === 1) { slot.style.gridRow = '3'; slot.style.gridColumn = '1'; }
                            if (s === 2) { slot.style.gridRow = '3'; slot.style.gridColumn = '2'; }
                        }

                        if (slotData) {
                            slot.classList.add('filled');
                            slot.style.background = `hsl(${(s - 1) * 60 + 200}, 70%, 50%)`;

                            if (highlightedSlotKey === slotKey) {
                                slot.classList.add('duplicate-highlight');
                            }
                            
                            const skus = slotData.skus || (slotData.sku ? [slotData.sku] : []);
                            if (skus.length === 1) {
                                slot.textContent = "..." + skus[0].slice(-4);
                            } else {
                                slot.textContent = `${skus.length} SKU`;
                            }

                            slot.style.cursor = 'pointer';
                            slot.onclick = () => {
                                showSlotSkusModal(b, s, skus, stateMgr);
                            };
                        } else {
                            slot.textContent = '空';
                        }
                        slotContainer.appendChild(slot);
                    }
                }
                bayCard.appendChild(slotContainer);
                bayGrid.appendChild(bayCard);
            }

            // Render BAY 10 (Unallocated SKUs)
            const bay10Container = document.getElementById('bay10Container');
            if (bay10Container) {
                const injectList = state.injectList || {};
                const slots = mergedSlots;
                
                // Get all SKUs currently in slots
                const allocatedSkus = new Set();
                Object.values(slots).forEach(slot => {
                    const skus = slot.skus || (slot.sku ? [slot.sku] : []);
                    skus.forEach(sku => allocatedSkus.add(sku));
                });
                
                // Count SKUs in injectList that are NOT in slots
                const unallocatedCount = Object.keys(injectList).filter(jan => !allocatedSkus.has(jan)).length;
                const nextBayNo = (state.config?.bays || 9) + 1;

                bay10Container.innerHTML = `
                    <div class="card" style="background: #f8fafc; border: 2px dashed #cbd5e1; text-align: center; padding: 1.5rem;">
                        <div style="font-size: 0.875rem; color: var(--text-muted); font-weight: 800; margin-bottom: 0.5rem;">No.${nextBayNo}</div>
                        <div style="font-size: 1.25rem; font-weight: 700; color: var(--text);">その他（未割り当て）</div>
                        <div style="font-size: 2.5rem; font-weight: 800; color: var(--warning); margin-top: 0.5rem;">
                            ${unallocatedCount} <span style="font-size: 1rem; color: var(--text-muted);">SKU</span>
                        </div>
                    </div>
                `;
            }
            } finally {
                perf?.mark("inject.render.end", {
                    durationMs: Math.round(performance.now() - renderStart),
                    mode: state?.mode || null,
                    bays: totalBays,
                    slotsCount: Object.keys(state?.slots || {}).length,
                    injectListCount: Object.keys(state?.injectList || {}).length,
                    pendingJanLast4: String(stateMgr.getEffectiveInjectPendingForCurrentUser(state)?.jan || '').slice(-4) || null,
                    optimisticSlotsCount: Object.keys(stateMgr.localUiState.optimisticSlots || {}).length
                });
            }
        };

        const showMessage = (text, type) => {
            scanMsg.textContent = text;
            scanMsg.className = `alert ${type}`;
            scanMsg.classList.remove('hidden');
        };

        const csvConfigBtn = document.getElementById('csvConfigBtn');
        const csvConfigModal = document.getElementById('csvConfigModal');
        const csvConfigCancel = document.getElementById('csvConfigCancel');
        const csvConfigSave = document.getElementById('csvConfigSave');
        const csvSkipHeader = document.getElementById('csvSkipHeader');
        const csvColPick = document.getElementById('csvColPick');
        const csvColJan = document.getElementById('csvColJan');
        const csvColQty = document.getElementById('csvColQty');
        const csvColLabel = document.getElementById('csvColLabel');
        const csvColProductCode = document.getElementById('csvColProductCode');
        const csvColProductName = document.getElementById('csvColProductName');

        const getSavedCsvFormat = () => {
            if (stateMgr.user && stateMgr.user.uid) {
                const saved = localStorage.getItem(`csvFormat_${stateMgr.user.uid}`);
                if (saved) {
                    try { return JSON.parse(saved); } catch (e) {}
                }
            }
            return stateMgr.state?.config?.csvFormat || { skipHeader: true, pickCol: 1, janCol: 2, qtyCol: 3, labelCol: null, productCodeCol: null, productNameCol: null };
        };

        const saveCsvFormat = (format) => {
            if (stateMgr.user && stateMgr.user.uid) {
                localStorage.setItem(`csvFormat_${stateMgr.user.uid}`, JSON.stringify(format));
            }
            const currentConfig = stateMgr.state?.config || {};
            stateMgr.update({ config: { ...currentConfig, csvFormat: format } });
        };

        csvConfigBtn.addEventListener('click', () => {
            const format = getSavedCsvFormat();
            csvSkipHeader.checked = format.skipHeader;
            csvColPick.value = format.pickCol;
            csvColJan.value = format.janCol;
            csvColQty.value = format.qtyCol;
            csvColLabel.value = format.labelCol || '';
            csvColProductCode.value = format.productCodeCol || '';
            csvColProductName.value = format.productNameCol || '';
            csvConfigModal.classList.remove('hidden');
        });

        csvConfigCancel.addEventListener('click', () => {
            csvConfigModal.classList.add('hidden');
        });

        csvConfigSave.addEventListener('click', () => {
            const format = {
                skipHeader: csvSkipHeader.checked,
                pickCol: parseInt(csvColPick.value, 10) || 1,
                janCol: parseInt(csvColJan.value, 10) || 2,
                qtyCol: parseInt(csvColQty.value, 10) || 3,
                labelCol: parseInt(csvColLabel.value, 10) || null,
                productCodeCol: parseInt(csvColProductCode.value, 10) || null,
                productNameCol: parseInt(csvColProductName.value, 10) || null
            };
            saveCsvFormat(format);
            csvConfigModal.classList.add('hidden');
            alert('CSVの列取り込み設定を更新しました。');
        });

        const processImportedRows = async (rows, format, sourceFile = null) => {
            const idxPick = format.pickCol - 1;
            const idxJan = format.janCol - 1;
            const idxQty = format.qtyCol - 1;
            const idxLabel = format.labelCol ? format.labelCol - 1 : null;
            const idxProductCode = format.productCodeCol ? format.productCodeCol - 1 : null;
            const idxProductName = format.productNameCol ? format.productNameCol - 1 : null;
            const targetRows = format.skipHeader ? rows.slice(1) : rows;

            const aggregatedInject = {};
            const productInfo = {};
            const labelVariantsByJan = {};
            const groupedPick = {};

            targetRows.forEach((row) => {
                const parts = Array.isArray(row)
                    ? row.map(v => String(v ?? '').trim())
                    : parseCsvLine(String(row ?? ''));
                const maxIdx = Math.max(idxPick, idxJan, idxQty);
                if (parts.length <= maxIdx) return;

                const pickNo = String(parts[idxPick] ?? '').trim();
                const jan = normalizeJan(String(parts[idxJan] ?? '').trim());
                const qtyRaw = String(parts[idxQty] ?? '').trim();
                const qty = parseInt(qtyRaw, 10) || 0;
                const productCode = idxProductCode !== null ? normalizeText(parts[idxProductCode]) : '';
                const productName = idxProductName !== null ? normalizeText(parts[idxProductName]) : '';
                const productLabel = buildProductLabel({
                    label: idxLabel !== null ? parts[idxLabel] : '',
                    productCode,
                    productName
                });

                if (!jan || !pickNo) return;

                // Aggregate for Injection validation
                aggregatedInject[jan] = (aggregatedInject[jan] || 0) + qty;
                if (!productInfo[jan] || (!productInfo[jan].productLabel && productLabel)) {
                    productInfo[jan] = { jan, productLabel, productCode, productName };
                }
                if (productLabel) {
                    if (!labelVariantsByJan[jan]) labelVariantsByJan[jan] = new Set();
                    labelVariantsByJan[jan].add(productLabel);
                }

                // Group for Picking Lists
                if (!groupedPick[pickNo]) groupedPick[pickNo] = [];
                groupedPick[pickNo].push({ jan, qty, checkedQty: 0, status: 'PENDING', productLabel, productCode, productName });
            });

            const updates = {
                injectList: aggregatedInject,
                productInfo,
                pickListSource: {
                    fileName: sourceFile?.name || null,
                    fileType: sourceFile?.type || '',
                    fileSize: sourceFile?.size || 0,
                    importedAt: Date.now()
                }
            };
            const currentSplits = stateMgr.state?.splits || {};
            const newSplits = { ...currentSplits };
            let needInit = false;
            const totalBays = stateMgr.state?.config?.bays || 9;
            for (let b = 1; b <= totalBays; b++) {
                if (newSplits[b] === undefined) {
                    newSplits[b] = 1;
                    needInit = true;
                }
            }
            if (needInit) updates.splits = newSplits;

            try {
                await stateMgr.replaceAllPickLists(groupedPick);
                await stateMgr.update(updates);
                const labelWarnings = Object.entries(labelVariantsByJan)
                    .filter(([, labels]) => labels.size > 1)
                    .map(([jan, labels]) => `同一JANに複数の商品表示名があります。\nJAN: ${jan}\n${Array.from(labels).map(label => `- ${label}`).join('\n')}\n\n現在仕様ではJAN単位で集約されます。CSV内容を確認してください。`);
                const warningText = labelWarnings.length ? `\n\n警告:\n${labelWarnings.join('\n\n')}` : '';
                if (labelWarnings.length) {
                    console.warn('[inject] 同一JANに複数の商品表示名があります', labelWarnings);
                    showMessage(`⚠️ 同一JANに複数の商品表示名があります。CSV内容を確認してください。対象: ${labelWarnings.length} JAN`, 'error');
                }
                alert(`${Object.keys(aggregatedInject).length} 品目のデータを読み込みました。\nピッキングリスト: ${Object.keys(groupedPick).length} 件${warningText}`);
            } catch (e) {
                console.error('インポートデータの保存に失敗しました:', e);
                alert('インポートデータの保存に失敗しました。通信状態をご確認ください。');
            }
        };

        loadCsvBtn.addEventListener('click', () => {
            const file = document.getElementById('csvFile').files[0];
            if (!file) return alert("ファイルを選択してください");

            const format = getSavedCsvFormat();
            const lowerName = (file.name || '').toLowerCase();
            const isExcel = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');
            const isCsv = lowerName.endsWith('.csv');
            if (!isCsv && !isExcel) {
                return alert('対応形式は CSV / Excel (.xlsx, .xls) です。');
            }

            const reader = new FileReader();
            reader.onload = async (e) => {
                if (isExcel) {
                    if (typeof XLSX === 'undefined') {
                        return alert('Excel読込ライブラリの読み込みに失敗しました。');
                    }
                    try {
                        const workbook = XLSX.read(e.target.result, { type: 'array' });
                        const firstSheetName = workbook.SheetNames[0];
                        if (!firstSheetName) {
                            return alert('Excelファイルにシートがありません。');
                        }
                        const firstSheet = workbook.Sheets[firstSheetName];
                        const rows = XLSX.utils.sheet_to_json(firstSheet, {
                            header: 1,
                            raw: false,
                            defval: ''
                        });
                        await processImportedRows(rows, format, file);
                    } catch (err) {
                        console.error('Excelファイルの解析に失敗しました:', err);
                        alert('Excelファイルの読み込みに失敗しました。ファイル形式をご確認ください。');
                    }
                    return;
                }

                const text = e.target.result;
                const lines = text.split(/\r?\n/).filter(x => x.trim());
                await processImportedRows(lines, format, file);
            };
            if (isExcel) {
                reader.readAsArrayBuffer(file);
            } else {
                reader.readAsText(file);
            }
        });

        const closeSlotImportModals = () => {
            slotImportPreviewModal.classList.add('hidden');
            slotImportConfirmModal.classList.add('hidden');
        };

        const parseSlotLayoutImportRows = (rows, state) => {
            if (!rows || rows.length === 0) throw new Error('format-invalid');
            const columnIndex = detectSlotImportColumnIndex(rows[0]);
            if (!columnIndex) throw new Error('format-invalid');

            const injectJanSet = new Set(Object.keys(state.injectList || {}));
            const splitConfig = state.splits || {};
            const rawRows = rows.slice(1);
            const importedSlots = {};
            const outOfScope = [];
            const duplicateJan = new Set();
            const duplicateJanRows = [];
            const invalidRows = [];
            const janToSlotKey = {};
            const janRowHistory = {};
            let readRows = 0;

            rawRows.forEach((row, idx) => {
                if (!Array.isArray(row)) return;
                const lineNo = idx + 2;
                const bayNo = toInt(row[columnIndex.bayCol]);
                const logicalNo = toInt(row[columnIndex.logicalCol]);
                const jan = normalizeJan(row[columnIndex.janCol]);
                const slotKey = `${bayNo}-${logicalNo}`;
                const maxSplit = splitConfig?.[bayNo];
                const basicInvalid =
                    !Number.isInteger(bayNo) || bayNo <= 0 ||
                    !Number.isInteger(logicalNo) || logicalNo <= 0 ||
                    !jan;
                if (basicInvalid) {
                    invalidRows.push(`行${lineNo}: 必要値不足または形式不正`);
                    return;
                }
                readRows++;
                if (!Number.isInteger(maxSplit) || logicalNo > maxSplit) {
                    invalidRows.push(`行${lineNo}: 間口No.${bayNo} / 詳細間口No.${logicalNo} が不正`);
                    return;
                }
                if (!injectJanSet.has(jan)) {
                    outOfScope.push(`${jan}（行${lineNo}）`);
                    return;
                }
                if (!janRowHistory[jan]) janRowHistory[jan] = [];
                janRowHistory[jan].push({ lineNo, slotKey });

                const existing = janToSlotKey[jan];
                if (existing) {
                    duplicateJan.add(jan);
                    return;
                }
                janToSlotKey[jan] = slotKey;
            });

            duplicateJan.forEach((jan) => {
                delete janToSlotKey[jan];
                (janRowHistory[jan] || []).forEach((info) => {
                    duplicateJanRows.push(`${jan}（行${info.lineNo}）`);
                });
            });
            Object.entries(janToSlotKey).forEach(([jan, slotKey]) => {
                if (!importedSlots[slotKey]) importedSlots[slotKey] = { skus: [] };
                importedSlots[slotKey].skus.push(jan);
            });

            return {
                readRows,
                importedSlots,
                outOfScope,
                duplicateJan: [...duplicateJan],
                duplicateJanRows,
                invalidRows
            };
        };

        const openSlotImportPreview = (preview) => {
            pendingSlotImportPreview = preview;
            renderSummaryGrid(slotImportPreviewSummary, [
                { label: '読込行数', value: preview.readRows },
                { label: '採用件数', value: preview.adoptedCount },
                { label: '除外行数', value: preview.excludedCount },
                { label: '現在配置中', value: preview.currentAssignedCount },
                { label: 'インポート後配置', value: preview.importedAssignedCount },
                { label: '継続配置', value: preview.intersectionCount },
                { label: '新規配置', value: preview.newOnlyCount },
                { label: '解除される既存配置', value: preview.removedOnlyCount },
                { label: '対象外行数', value: preview.outOfScopeCount },
                { label: '同一JAN重複行数', value: preview.duplicateJanCount },
                { label: '不正行数', value: preview.invalidCount }
            ]);
            renderDetailList(slotImportPreviewOutOfScope, preview.outOfScope);
            renderDetailList(slotImportPreviewDuplicateJan, preview.duplicateJanRows);
            renderDetailList(slotImportPreviewInvalidRows, preview.invalidRows);
            slotImportPreviewModal.classList.remove('hidden');
        };

        importSlotLayoutBtn.addEventListener('click', async () => {
            const state = stateMgr.state;
            if (!hasPickListLoaded(state)) {
                alert('先にピッキングリストを読込してください');
                return;
            }
            const file = slotCsvFileInput.files[0];
            if (!file) {
                alert('ファイルを選択してください');
                return;
            }

            try {
                const rows = await readTableRowsFromFile(file);
                const parsed = parseSlotLayoutImportRows(rows, state);
                const comparison = buildComparisonSummary(state, parsed.importedSlots);
                const adoptedCount = Object.keys(parsed.importedSlots)
                    .reduce((sum, key) => sum + (parsed.importedSlots[key]?.skus?.length || 0), 0);
                const excludedCount = parsed.outOfScope.length + parsed.duplicateJanRows.length + parsed.invalidRows.length;

                openSlotImportPreview({
                    ...parsed,
                    adoptedCount,
                    excludedCount,
                    outOfScopeCount: parsed.outOfScope.length,
                    duplicateJanCount: parsed.duplicateJanRows.length,
                    invalidCount: parsed.invalidRows.length,
                    currentAssignedCount: comparison.currentAssignedJanSet.size,
                    importedAssignedCount: comparison.importedAssignedJanSet.size,
                    intersectionCount: comparison.intersection.size,
                    newOnlyCount: comparison.newOnly.size,
                    removedOnlyCount: comparison.removedOnly.size
                });
            } catch (error) {
                console.error('間口配置インポートの解析に失敗しました:', error);
                alert('インポートファイルを解析できませんでした\n必要列（間口No / 詳細間口No / JAN）を確認してください');
            }
        });

        exportSlotLayoutBtn.addEventListener('click', () => {
            const state = stateMgr.state || {};
            const slots = state.slots || {};
            const injectList = state.injectList || {};
            const rows = [['bay_no', 'logical_slot_no', 'jan', 'reference_qty', 'assignment_status']];
            const allocatedJanSet = new Set();
            Object.entries(slots).forEach(([slotKey, slot]) => {
                const [bayNo, logicalNo] = slotKey.split('-');
                const skus = slot?.skus || (slot?.sku ? [slot.sku] : []);
                skus.forEach((jan) => {
                    allocatedJanSet.add(String(jan));
                    rows.push([bayNo, logicalNo, jan, injectList[jan] || 0, 'assigned']);
                });
            });
            Object.keys(injectList).forEach((jan) => {
                if (allocatedJanSet.has(jan)) return;
                rows.push(['UNASSIGNED', 'UNASSIGNED', jan, injectList[jan] || 0, 'unassigned']);
            });
            const csvText = rows.map((row) => row.map((cell) => {
                const v = String(cell ?? '');
                return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
            }).join(',')).join('\n');
            const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
            a.href = url;
            a.download = `slot-layout-snapshot-${stamp}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });

        document.getElementById('slotImportPreviewCancelBtn').addEventListener('click', () => {
            pendingSlotImportPreview = null;
            closeSlotImportModals();
        });

        document.getElementById('slotImportPreviewProceedBtn').addEventListener('click', () => {
            if (!pendingSlotImportPreview) return;
            ensureNoInProgressWorkForSlotImport().then((ok) => {
                if (!ok) return;
                renderSummaryGrid(slotImportConfirmSummary, [
                    { label: '採用件数', value: pendingSlotImportPreview.adoptedCount },
                    { label: '解除される既存配置', value: pendingSlotImportPreview.removedOnlyCount },
                    { label: '除外行数', value: pendingSlotImportPreview.excludedCount }
                ]);
                slotImportPreviewModal.classList.add('hidden');
                slotImportConfirmModal.classList.remove('hidden');
            });
        });

        document.getElementById('slotImportConfirmBackBtn').addEventListener('click', () => {
            slotImportConfirmModal.classList.add('hidden');
            slotImportPreviewModal.classList.remove('hidden');
        });

        document.getElementById('slotImportConfirmApplyBtn').addEventListener('click', async () => {
            if (!pendingSlotImportPreview) return;
            const preview = pendingSlotImportPreview;
            if (preview.adoptedCount === 0) {
                closeSlotImportModals();
                pendingSlotImportPreview = null;
                alert('反映できるデータがありませんでした\nピッキングリスト対象外または不正データのみが含まれていました');
                return;
            }
            try {
                await stateMgr.replaceSlotLayout(preview.importedSlots);
                clearLocalInjectUiState();
                closeSlotImportModals();
                pendingSlotImportPreview = null;
                if (preview.excludedCount > 0) {
                    alert(`間口配置を更新しました\n${preview.adoptedCount}件を配置しました\n${preview.excludedCount}件は対象外または不正データのため反映していません`);
                } else {
                    alert(`間口配置を更新しました\n${preview.adoptedCount}件を配置し、${preview.removedOnlyCount}件の既存配置を解除しました`);
                }
                if (preview.duplicateJanCount > 0) {
                    showMessage('同一JANの重複記載（同一間口含む）があるため、一部データを除外しました', 'error');
                }
            } catch (error) {
                console.error('間口配置の反映に失敗しました:', error);
                alert('間口配置の更新に失敗しました。通信状態をご確認ください。');
            }
        });

        scanInput.addEventListener('keydown', async (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (scanInput.disabled) return;
            const jan = normalizeJan(scanInput.value);
            const state = stateMgr.state;
            const totalQty = state.injectList?.[jan];

            if (!jan || totalQty === undefined) {
                AudioManager.playErrorSound();
                showMessage(`❌ SKU ${jan} はリストにありません`, 'error');
            } else {
                const janToSlot = getMergedJanIndex(state);
                const assignedSlotKey = janToSlot[jan];
                const alreadyInSlot = !!assignedSlotKey;

                if (alreadyInSlot) {
                    AudioManager.playErrorSound();
                    highlightDuplicateSlot(assignedSlotKey);
                    showMessage(`⚠️ SKU ${jan} は No.${assignedSlotKey} に投入済みです`, 'error');
                    stateMgr.triggerDuplicateHighlight(assignedSlotKey, jan).catch((error) => {
                        console.error('duplicateHighlight の共有に失敗しました:', error);
                    });
                } else {
                    const now = Date.now();
                    if (lastAcceptedJan === jan && (now - lastAcceptedAt) < 500) {
                        scanInput.value = '';
                        return;
                    }
                    stateMgr.clearDuplicateHighlight().catch((error) => {
                        console.error('duplicateHighlight の解除に失敗しました:', error);
                    });
                    lastAcceptedJan = jan;
                    lastAcceptedAt = now;
                    const requestId = stateMgr.createInjectRequestId();
                    const pending = {
                        jan,
                        status: "WAITING_SLOT",
                        requestedAt: Date.now(),
                        requestId
                    };
                    if (totalQty > 1) {
                        AudioManager.playMultipleStartSound();
                    } else {
                        AudioManager.playStartSound();
                    }
                    stateMgr.setLocalInjectPending(pending);
                    stateMgr.setLocalInjectPending(pending);
                    scanInput.disabled = true;
                    scanInput.parentElement.style.opacity = '0.5';
                    try {
                        const saveResult = await stateMgr.saveInjectPendingSafely(pending);
                        if (saveResult?.skipped) {
                            console.debug('saveInjectPendingSafely skipped', saveResult);
                            stateMgr.clearLocalInjectPending();
                            scanInput.disabled = false;
                            scanInput.parentElement.style.opacity = '1';
                            scanInput.value = '';
                            scanMsg.classList.add('hidden');
                            setTimeout(() => scanInput.focus(), 50);
                            return;
                        }
                    } catch (error) {
                        console.error('injectPending の保存に失敗しました:', error);
                        stateMgr.rollbackOptimisticInject();
                        scanInput.disabled = false;
                        scanInput.parentElement.style.opacity = '1';
                        AudioManager.playErrorSound();
                        showMessage('❌ 通信エラーにより投入待機を保存できませんでした。再度スキャンしてください。', 'error');
                    }
                }
            }
            scanInput.value = '';
        });

        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.getAttribute('data-page');
                guardedNavigate(page);
            });
        });
    });
})();
