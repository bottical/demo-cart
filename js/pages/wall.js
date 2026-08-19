// Mobile Wall Logic (Non-module)
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const wallHeader = document.getElementById('wallHeader');
        const wallTitle = document.getElementById('wallTitle');
        const backBtn = document.getElementById('backBtn');
        const openSettingsBtn = document.getElementById('openSettingsBtn');
        const openOthersBtn = document.getElementById('openOthersBtn');
        const homeBtn = document.getElementById('homeBtn');
        const verifyScannerControls = document.getElementById('verifyScannerControls');
        const scannerToggleBtn = document.getElementById('scannerToggleBtn');
        const cameraFacingSelect = document.getElementById('cameraFacingSelect');
        const scannerStatusLabel = document.getElementById('scannerStatusLabel');
        const scannerResultLabel = document.getElementById('scannerResultLabel');
        const scannerPreview = document.getElementById('scannerPreview');
        
        const multiViewContainer = document.getElementById('multiViewContainer');
        const selectorViewContainer = document.getElementById('selectorViewContainer');
        const singleViewContainer = document.getElementById('singleViewContainer');
        const bay10Container = document.getElementById('bay10-container');
        
        const setupOverlay = document.getElementById('setupOverlay');
        const settingBays = document.getElementById('settingBays');
        const settingBaysRiskNotice = document.getElementById('settingBaysRiskNotice');
        const settingViewMode = document.getElementById('settingViewMode');
        const singleSettings = document.getElementById('singleSettings');
        const settingOrientation = document.getElementById('settingOrientation');
        const multiSettings = document.getElementById('multiSettings');
        const settingMultiRows = document.getElementById('settingMultiRows');
        const settingMultiCols = document.getElementById('settingMultiCols');
        const settingMultiStartId = document.getElementById('settingMultiStartId');
        const settingDisplayScale = document.getElementById('settingDisplayScale');
        const settingDenseTextMode = document.getElementById('settingDenseTextMode');
        const settingBulkSplit = document.getElementById('settingBulkSplit');
        const applyBulkSplitBtn = document.getElementById('applyBulkSplitBtn');
        const saveDisplaySettingsBtn = document.getElementById('saveDisplaySettingsBtn');
        const saveAdvancedSettingsBtn = document.getElementById('saveAdvancedSettingsBtn');
        const advancedSettingsDetails = document.getElementById('advancedSettingsDetails');
        const currentBaysValue = document.getElementById('currentBaysValue');
        const closeSettingsBtn = document.getElementById('closeSettingsBtn');
        const getValidBaysOrBlock = (state, messageTarget = multiViewContainer) => {
            const totalBays = window.getValidConfiguredBays ? window.getValidConfiguredBays(state) : null;
            if (totalBays === null) {
                const text = stateMgr.globalLayoutSettingsLoadFailed
                    ? '総間口数を取得できませんでした。通信状態を確認して再読み込みしてください。安全のため投入操作を停止しています。'
                    : '間口設定を読み込んでいます。このままお待ちください。';
                if (messageTarget) messageTarget.innerHTML = `<div class="card" style="padding:2rem; text-align:center; color:var(--danger); font-weight:800;">${text}</div>`;
                return null;
            }
            return totalBays;
        };
        const ensureBaysReady = () => {
            const totalBays = window.getValidConfiguredBays ? window.getValidConfiguredBays(stateMgr.state) : null;
            if (totalBays === null) {
                alert('総間口数を取得できませんでした。通信状態を確認して再読み込みしてください。安全のため操作を停止しています。');
                return null;
            }
            return totalBays;
        };

        const DEVICE_SETTINGS_KEY = 'picking_shelf_wall_device_settings_v1';
        const globalSettingsLoadWarning = document.getElementById('globalSettingsLoadWarning');

        const getDeviceWallSettings = () => {
            try {
                return JSON.parse(localStorage.getItem(DEVICE_SETTINGS_KEY) || '{}');
            } catch (e) {
                return {};
            }
        };

        const saveDeviceWallSettings = (partial) => {
            const current = getDeviceWallSettings();
            const next = { ...current, ...partial };
            localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(next));
            return next;
        };

        const getEffectiveWallConfig = (state) => {
            const config = state?.config || {};
            const deviceSettings = getDeviceWallSettings();
            return {
                ...config,
                viewMode: ['single', 'multi'].includes(deviceSettings.viewMode) ? deviceSettings.viewMode : (config.viewMode || 'multi'),
                multiRows: parseInt(deviceSettings.multiRows, 10) || config.multiRows || 3,
                multiCols: parseInt(deviceSettings.multiCols, 10) || config.multiCols || 3,
                showOthers: deviceSettings.showOthers !== undefined ? deviceSettings.showOthers !== false : config.showOthers !== false
            };
        };

        const updateGlobalSettingsLoadWarning = () => {
            const failed = !!stateMgr.globalLayoutSettingsLoadFailed;
            if (globalSettingsLoadWarning) globalSettingsLoadWarning.classList.toggle('hidden', !failed);
            if (applyBulkSplitBtn) {
                applyBulkSplitBtn.dataset.globalLoadBlocked = failed ? 'true' : 'false';
                applyBulkSplitBtn.disabled = failed;
                applyBulkSplitBtn.textContent = failed ? '通信復帰後に適用してください' : '一括分割を適用';
            }
            if (saveAdvancedSettingsBtn) {
                saveAdvancedSettingsBtn.dataset.globalLoadBlocked = failed ? 'true' : 'false';
                if (failed) {
                    saveAdvancedSettingsBtn.disabled = true;
                    saveAdvancedSettingsBtn.textContent = '通信復帰後に保存してください';
                } else if (saveAdvancedSettingsBtn.dataset.baysRiskBlocked !== 'true' && saveAdvancedSettingsBtn.dataset.otherValidationBlocked !== 'true') {
                    saveAdvancedSettingsBtn.disabled = false;
                    saveAdvancedSettingsBtn.textContent = '全端末共通のレイアウト設定を保存';
                }
            }
        };

        // Bay Edit Elements
        const bayEditOverlay = document.getElementById('bayEditOverlay');
        const editBayTitle = document.getElementById('editBayTitle');
        const bayAddSplitBtn = document.getElementById('bayAddSplitBtn');
        const bayRemoveSplitBtn = document.getElementById('bayRemoveSplitBtn');
        const bayResetBtn = document.getElementById('bayResetBtn');
        const bayEditCancelBtn = document.getElementById('bayEditCancelBtn');
        let editTargetBay = null;

        let currentSingleBayId = null; // null means show selector
        let scannerStream = null;
        let scannerTimer = null;
        let barcodeDetector = null;
        let lastScannedJan = null;
        let lastScannedAt = 0;
        let scannerRunning = false;


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
                render(state);
                updateUserSelectorUI();
            },
            (user) => {
                if (!user) window.location.href = 'index.html';
            }
        );

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

        let navigationGuardErrorTimer = null;
        let offlineFallbackSetupShown = false;
        const showOfflineFallbackNotice = () => {
            let el = document.getElementById('offlineFallbackNotice');
            if (!el) {
                el = document.createElement('div');
                el.id = 'offlineFallbackNotice';
                el.style.position = 'fixed';
                el.style.left = '50%';
                el.style.top = 'calc(env(safe-area-inset-top, 0px) + 72px)';
                el.style.transform = 'translateX(-50%)';
                el.style.width = 'min(92vw, 560px)';
                el.style.background = '#78350f';
                el.style.color = '#fffbeb';
                el.style.padding = '12px 14px';
                el.style.border = '1px solid #f59e0b';
                el.style.borderRadius = '10px';
                el.style.zIndex = '3100';
                el.style.lineHeight = '1.55';
                el.style.fontWeight = '700';
                el.style.boxShadow = '0 10px 30px rgba(0,0,0,0.25)';
                document.body.appendChild(el);
            }
            el.innerHTML = '通信不安定のため、現在は前回取得したレイアウト設定のみを表示しています。<br>作業データは最新ではない可能性があります。<br>通信復帰後に自動更新されます。';
        };

        const hideOfflineFallbackNotice = () => {
            document.getElementById('offlineFallbackNotice')?.remove();
        };

        const showNavigationGuardError = (message) => {
            let el = document.getElementById('navigationGuardError');
            if (!el) {
                el = document.createElement('div');
                el.id = 'navigationGuardError';
                el.style.position = 'fixed';
                el.style.left = '50%';
                el.style.bottom = '20px';
                el.style.transform = 'translateX(-50%)';
                el.style.background = '#7f1d1d';
                el.style.color = '#fff';
                el.style.padding = '10px 14px';
                el.style.border = '1px solid #ef4444';
                el.style.borderRadius = '8px';
                el.style.zIndex = '3200';
                document.body.appendChild(el);
            }
            el.textContent = message;
            if (navigationGuardErrorTimer) clearTimeout(navigationGuardErrorTimer);
            navigationGuardErrorTimer = setTimeout(() => {
                el.remove();
            }, 5000);
        };
        const navGuard = window.NavigationGuard.createNavigationHelpers({
            stateMgr,
            audioManager: AudioManager,
            onCancelError: () => {
                showNavigationGuardError('作業のキャンセルに失敗したため、ページ移動を中止しました。通信状態をご確認ください。');
            }
        });
        const guardedNavigate = navGuard.guardedNavigate;
        navGuard.installBeforeUnloadGuard();

        // --- Setup Logic ---
        settingViewMode.addEventListener('change', () => {
            if (singleSettings) singleSettings.classList.add('hidden');
            if (multiSettings) multiSettings.classList.toggle('hidden', settingViewMode.value !== 'multi');
        });

        const showSetup = (canCancel) => {
            setupOverlay.classList.remove('hidden');
            if (canCancel) {
                closeSettingsBtn.classList.remove('hidden');
            } else {
                closeSettingsBtn.classList.add('hidden');
            }
            // Populate current values
            updateGlobalSettingsLoadWarning();
            const cfg = getEffectiveWallConfig(stateMgr.state);
            if (cfg.bays) settingBays.value = cfg.bays;
            if (cfg.viewMode) settingViewMode.value = cfg.viewMode;
            if (cfg.orientation) settingOrientation.value = cfg.orientation;
            if (cfg.multiRows) settingMultiRows.value = cfg.multiRows;
            if (cfg.multiCols) settingMultiCols.value = cfg.multiCols;
            currentBaysValue.textContent = window.getValidConfiguredBays({ config: cfg }) ?? '未取得';
            const deviceSettings = getDeviceWallSettings();
            settingMultiStartId.value = deviceSettings.multiStartId || cfg.multiStartId || 1;
            settingDisplayScale.value = deviceSettings.displayScale || 'M';
            settingDenseTextMode.checked = deviceSettings.denseTextMode !== false;
            settingBulkSplit.value = '';
            advancedSettingsDetails.open = !cfg.bays;
            document.getElementById('settingShowOthers').checked = cfg.showOthers !== false;
            settingViewMode.dispatchEvent(new Event('change'));
            refreshBaysRiskUi();
        };

        const hideSetup = () => setupOverlay.classList.add('hidden');

        openSettingsBtn.addEventListener('click', () => showSetup(true));
        if (openOthersBtn) {
            openOthersBtn.addEventListener('click', () => {
                currentSingleBayId = 'unallocated';
                render(stateMgr.state);
            });
        }
        closeSettingsBtn.addEventListener('click', () => hideSetup());
        settingBays.addEventListener('input', () => refreshBaysRiskUi());
        settingBays.addEventListener('change', () => refreshBaysRiskUi());

        saveDisplaySettingsBtn.addEventListener('click', async () => {
            const currentConfig = getEffectiveWallConfig(stateMgr.state);
            if (!currentConfig.bays) {
                advancedSettingsDetails.open = true;
                alert('先に総間口数を設定してください。');
                return;
            }
            const localMultiStartId = Math.max(1, parseInt(settingMultiStartId.value, 10) || 1);
            const localDisplayScale = ['S', 'M', 'L'].includes(settingDisplayScale.value) ? settingDisplayScale.value : 'M';
            saveDeviceWallSettings({
                multiStartId: localMultiStartId,
                displayScale: localDisplayScale,
                denseTextMode: !!settingDenseTextMode.checked,
                viewMode: settingViewMode.value,
                multiRows: parseInt(settingMultiRows.value, 10) || 3,
                multiCols: parseInt(settingMultiCols.value, 10) || 3,
                showOthers: document.getElementById('settingShowOthers').checked
            });

            try {
                hideSetup();
                render(stateMgr.state);
                alert('この端末の表示設定を保存しました。他の端末には影響しません。');
            } catch (error) {
                console.error('この端末の表示設定の保存に失敗しました:', error);
                alert('この端末の表示設定を保存できませんでした。ブラウザの保存領域または端末設定をご確認ください。');
            }
        });

        applyBulkSplitBtn.addEventListener('click', async () => {
            if (ensureBaysReady() === null) return;
            updateGlobalSettingsLoadWarning();

            if (stateMgr.globalLayoutSettingsLoadFailed) {
                alert('全端末共通のレイアウト設定を取得できないため、一括分割を適用できません。通信復帰後に再読み込みしてください。');
                return;
            }

            const bulkSplit = parseInt(settingBulkSplit.value, 10);
            if (!(bulkSplit >= 1 && bulkSplit <= 6)) {
                alert('適用する分割数を選択してください。');
                return;
            }

            const ok = confirm(
                `全間口に ${bulkSplit} 分割を適用します。\n\n` +
                `この操作は全端末のWALL表示に反映されます。\n` +
                `縮小できない間口は既存データ保護のため据え置かれます。\n\n` +
                `実行しますか？`
            );

            if (!ok) return;

            try {
                const result = await stateMgr.applyBulkSplitCount(bulkSplit);
                settingBulkSplit.value = '';

                if (result) {
                    alert(`一括分割設定を適用しました（変更 ${result.changedBays} 間口 / 制約で据え置き ${result.constrainedBays} 間口）`);
                }

                render(stateMgr.state);
            } catch (error) {
                console.error('一括分割設定の適用に失敗しました:', error);
                alert('一括分割設定の適用に失敗しました。通信状態をご確認ください。');
            }
        });

        saveAdvancedSettingsBtn.addEventListener('click', async () => {
            if (ensureBaysReady() === null) return;
            updateGlobalSettingsLoadWarning();
            if (stateMgr.globalLayoutSettingsLoadFailed) {
                alert('全端末共通のレイアウト設定を取得できないため保存できません。通信復帰後に再読み込みしてください。');
                return;
            }
            const currentConfig = stateMgr.state?.config || {};
            const nextBays = parseInt(settingBays.value, 10);
            if (!Number.isInteger(nextBays) || nextBays < 1 || nextBays > 100) { alert('総間口数は1〜100で入力してください。'); return; }
            const oldBays = parseInt(currentConfig.bays, 10) || null;

            const saveRisk = buildBaysReductionRisk(stateMgr.state, nextBays);
            if (saveRisk.blocked) {
                alert(buildBaysReductionBlockedMessage(saveRisk));
                refreshBaysRiskUi();
                return;
            }

            if (oldBays && nextBays !== oldBays) {
                const ok = confirm(
                    `総間口数を変更します。\n\n` +
                    `現在: ${oldBays}\n` +
                    `変更後: ${nextBays}\n\n` +
                    `この変更は全端末の表示構成に影響します。\n` +
                    `誤って変更すると、表示範囲やピッキング表示が大きく変わる可能性があります。\n\n` +
                    `本当に保存しますか？`
                );
                if (!ok) return;
            }

            // viewMode / multiRows / multiCols / showOthers は端末ごとの表示設定。
            // 既存Firestore configに残っている値は互換用に保持するが、全端末共通設定の保存では更新しない。
            const newConfig = {
                ...currentConfig,
                bays: nextBays,
                viewMode: currentConfig.viewMode || 'multi',
                orientation: settingOrientation.value,
                multiRows: currentConfig.multiRows || 3,
                multiCols: currentConfig.multiCols || 3,
                showOthers: currentConfig.showOthers !== false,
                maxSplit: 6,
                pickMode: currentConfig.pickMode === 'VERIFY' ? 'VERIFY' : 'NORMAL',
                quantityVerification: !!currentConfig.quantityVerification
            };

            try {
                await stateMgr.updateConfiguredBays(nextBays);
                await stateMgr.update({ 'config.orientation': settingOrientation.value });
                hideSetup();
                alert('全端末共通のレイアウト設定を保存しました。スマホ・タブレットを含む全WALL画面に反映されます。');
                currentSingleBayId = null;
                render(stateMgr.state);
            } catch (error) {
                console.error('全端末共通のレイアウト設定の保存に失敗しました:', error);
                alert('全端末共通のレイアウト設定の保存に失敗しました。通信状態をご確認ください。');
            }
        });

        // --- Edit Bay Logic ---
        bayEditCancelBtn.onclick = () => bayEditOverlay.classList.add('hidden');
        
        bayAddSplitBtn.onclick = () => {
            if (!editTargetBay) return;
            const splitCount = stateMgr.state.splits?.[editTargetBay] || 1;
            const maxSplit = 6;
            if (splitCount < maxSplit) {
                stateMgr.update({ [`splits.${editTargetBay}`]: splitCount + 1 });
            }
            bayEditOverlay.classList.add('hidden');
        };

        bayRemoveSplitBtn.onclick = () => {
            if (!editTargetBay) return;
            const splitCount = stateMgr.state?.splits?.[editTargetBay] || 1;
            if (splitCount > 1) {
                const splitRisk = buildSplitReductionRisk(stateMgr.state, editTargetBay, splitCount - 1);
                if (splitRisk.blocked) {
                    alert(buildSplitReductionBlockedMessage(splitRisk));
                } else {
                    stateMgr.update({ [`splits.${editTargetBay}`]: splitCount - 1 });
                }
            }
            bayEditOverlay.classList.add('hidden');
        };

        bayResetBtn.onclick = () => {
            if (!editTargetBay) return;
            if (confirm(`No.${editTargetBay} に割り当てられている商品をすべて未割り当てに戻しますか？`)) {
                stateMgr.resetBay(editTargetBay);
            }
            bayEditOverlay.classList.add('hidden');
        };

        const showBayEditMenu = (b, state) => {
            editTargetBay = b;
            editBayTitle.textContent = `No.${b} の設定`;
            
            const splitCount = state.splits?.[b] || 1;
            const maxSplit = 6;
            const splitRisk = buildSplitReductionRisk(state, b, splitCount - 1);

            bayAddSplitBtn.disabled = splitCount >= maxSplit;
            bayAddSplitBtn.style.opacity = splitCount >= maxSplit ? "0.5" : "1";
            
            bayRemoveSplitBtn.disabled = splitCount <= 1 || splitRisk.blocked;
            bayRemoveSplitBtn.style.opacity = bayRemoveSplitBtn.disabled ? "0.5" : "1";
            bayRemoveSplitBtn.title = splitRisk.blocked ? getSplitReductionBlockedTitle(splitRisk) : '';
            
            bayEditOverlay.classList.remove('hidden');
        };

        // --- Render Helpers ---

        const getPickColor = (s) => {
            const colors = ['#2563eb', '#16a34a', '#d97706', '#db2777', '#8b5cf6', '#06b6d4', '#f43f5e', '#84cc16', '#64748b'];
            return colors[(s - 1) % colors.length];
        };

        const getGridClass = (splitCount, orientation) => {
            if (splitCount === 1) return 'grid-split-1';
            if (splitCount === 2) return orientation === 'portrait' ? 'grid-split-2-p' : 'grid-split-2-l';
            if (splitCount === 3) return 'grid-split-3'; // Both landscape and portrait same layout
            if (splitCount === 4) return 'grid-split-4';
            if (splitCount === 5) return orientation === 'portrait' ? 'grid-split-5-p' : 'grid-split-5-l';
            return orientation === 'portrait' ? 'grid-split-6-p' : 'grid-split-6-l';
        };

        const SLOT_LAYOUTS = {
            portrait: {
                2: {
                    2: { row: '1', column: '1' },
                    1: { row: '2', column: '1' }
                },
                3: {
                    3: { row: '1', column: '1 / span 2' },
                    1: { row: '2', column: '1' },
                    2: { row: '2', column: '2' }
                },
                4: {
                    3: { row: '1', column: '1' },
                    4: { row: '1', column: '2' },
                    1: { row: '2', column: '1' },
                    2: { row: '2', column: '2' }
                },
                5: {
                    5: { row: '1', column: '1 / span 2' },
                    3: { row: '2', column: '1' },
                    4: { row: '2', column: '2' },
                    1: { row: '3', column: '1' },
                    2: { row: '3', column: '2' }
                },
                6: {
                    5: { row: '1', column: '1' },
                    6: { row: '1', column: '2' },
                    3: { row: '2', column: '1' },
                    4: { row: '2', column: '2' },
                    1: { row: '3', column: '1' },
                    2: { row: '3', column: '2' }
                }
            },
            landscape: {
                2: {
                    2: { row: '1', column: '1' },
                    1: { row: '1', column: '2' }
                },
                3: {
                    3: { row: '1', column: '1 / span 2' },
                    1: { row: '2', column: '1' },
                    2: { row: '2', column: '2' }
                },
                4: {
                    3: { row: '1', column: '1' },
                    4: { row: '2', column: '1' },
                    1: { row: '1', column: '2' },
                    2: { row: '2', column: '2' }
                },
                5: {
                    5: { row: '1 / span 2', column: '1' },
                    3: { row: '1', column: '2' },
                    4: { row: '2', column: '2' },
                    1: { row: '1', column: '3' },
                    2: { row: '2', column: '3' }
                },
                6: {
                    5: { row: '1', column: '1' },
                    6: { row: '2', column: '1' },
                    3: { row: '1', column: '2' },
                    4: { row: '2', column: '2' },
                    1: { row: '1', column: '3' },
                    2: { row: '2', column: '3' }
                }
            }
        };

        const getSlotPlacement = (splitCount, slotNo, orientation) => {
            const orientationLayouts = SLOT_LAYOUTS[orientation];
            if (!orientationLayouts) return null;
            return orientationLayouts[splitCount]?.[slotNo] || null;
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

        const getSlotSkus = (slot) => {
            if (!slot) return [];
            if (Array.isArray(slot.skus)) {
                return slot.skus.filter((sku) => sku !== null && sku !== undefined && String(sku).trim() !== '');
            }
            if (slot.sku !== null && slot.sku !== undefined && String(slot.sku).trim() !== '') {
                return [slot.sku];
            }
            return [];
        };

        const collectActiveSlotsInBayRange = (state, startBay, endBay) => {
            if (!state) return [];
            const mergedSlots = getMergedSlots(state);
            const activeSlots = [];
            Object.entries(mergedSlots).forEach(([slotKey, slot]) => {
                const [bayText, slotText] = String(slotKey).split('-');
                const bay = parseInt(bayText, 10);
                const slotNo = parseInt(slotText, 10);
                if (!Number.isInteger(bay) || bay < startBay || bay > endBay) return;
                const skus = getSlotSkus(slot);
                if (skus.length === 0) return;
                activeSlots.push({
                    slotKey,
                    bay,
                    slot: Number.isInteger(slotNo) ? slotNo : null,
                    skus: [...skus]
                });
            });
            return activeSlots.sort((a, b) => a.bay - b.bay || (a.slot || 0) - (b.slot || 0));
        };

        const buildBaysReductionRisk = (state, nextBaysInput) => {
            const currentBays = getValidBaysOrBlock(state);
            if (currentBays === null) return;
            const parsedNextBays = parseInt(nextBaysInput, 10);
            const nextBays = Number.isFinite(parsedNextBays) ? Math.max(1, parsedNextBays) : null;
            if (nextBays === null) return { blocked: true, activeSlots: [], currentBays, nextBays: null };
            const isReduction = nextBays < currentBays;
            if (!isReduction) {
                return {
                    isReduction: false,
                    currentBays,
                    nextBays,
                    affectedBayStart: null,
                    affectedBayEnd: null,
                    activeSlots: [],
                    blocked: !state,
                    reason: !state ? 'loading' : null
                };
            }
            const affectedBayStart = nextBays + 1;
            const affectedBayEnd = currentBays;
            const activeSlots = collectActiveSlotsInBayRange(state, affectedBayStart, affectedBayEnd);
            const reason = !state ? 'loading' : (activeSlots.length > 0 ? 'occupied' : null);
            return {
                isReduction: true,
                currentBays,
                nextBays,
                affectedBayStart,
                affectedBayEnd,
                activeSlots,
                blocked: reason !== null,
                reason
            };
        };

        const buildSplitReductionRisk = (state, bayInput, nextSplitInput) => {
            const bay = parseInt(bayInput, 10);
            const currentSplit = parseInt(state?.splits?.[bay], 10) || 1;
            const parsedNextSplit = parseInt(nextSplitInput, 10);
            const nextSplit = Number.isFinite(parsedNextSplit) ? Math.max(1, parsedNextSplit) : currentSplit;
            const isReduction = nextSplit < currentSplit;
            if (!isReduction) {
                return {
                    isReduction: false,
                    bay,
                    currentSplit,
                    nextSplit,
                    affectedSlotStart: null,
                    affectedSlotEnd: null,
                    activeSlots: [],
                    blocked: !state,
                    reason: !state ? 'loading' : null
                };
            }
            if (!state) {
                return {
                    isReduction: true,
                    bay,
                    currentSplit,
                    nextSplit,
                    affectedSlotStart: nextSplit + 1,
                    affectedSlotEnd: currentSplit,
                    activeSlots: [],
                    blocked: true,
                    reason: 'loading'
                };
            }
            const activeSlots = collectActiveSlotsInBayRange(state, bay, bay)
                .filter((item) => item.slot && item.slot > nextSplit);
            return {
                isReduction: true,
                bay,
                currentSplit,
                nextSplit,
                affectedSlotStart: nextSplit + 1,
                affectedSlotEnd: currentSplit,
                activeSlots,
                blocked: activeSlots.length > 0,
                reason: activeSlots.length > 0 ? 'occupied' : null
            };
        };

        const buildBaysReductionBlockedMessage = (risk) => {
            if (risk?.reason === 'loading') {
                return '状態読込中のため保存できません。少し待ってから再度お試しください。';
            }
            if (!risk || !risk.isReduction) {
                return '総間口数を減らせません。設定値を確認してください。';
            }
            const problemBays = [...new Set(risk.activeSlots.map((item) => `No.${item.bay}`))].join(', ');
            const problemSlots = risk.activeSlots.map((item) => item.slotKey).join(', ');
            return `総間口数を減らせません。${problemBays} に投入済みSKUが残っています（${problemSlots}）。先に対象間口を空にしてから変更してください。表示外に残ると、ピッキング時に「その他」扱いになる可能性があります。`;
        };

        const buildSplitReductionBlockedMessage = (risk) => {
            if (!risk || !risk.isReduction) {
                return '分割数を減らせません。設定値を確認してください。';
            }
            if (risk.reason === 'loading') {
                return `No.${risk.bay} の分割数を減らせません。状態読込中のため、少し待ってから再度お試しください。`;
            }
            const problemSlots = risk.activeSlots.map((item) => item.slotKey).join(', ');
            return `No.${risk.bay} の分割数を減らせません。縮小対象の論理間口に投入済みSKUが残っています（${problemSlots}）。先に対象論理間口を空にしてください。`;
        };

        const getSplitReductionBlockedTitle = (risk) => {
            if (!risk?.blocked) return '';
            if (risk.reason === 'loading') return '状態読込中のため減らせません';
            if (risk.reason === 'occupied') return '縮小対象の論理間口に投入済みSKUがあります';
            return '';
        };

        // NOTE: ここは「bays 縮小リスク」専用の保存ボタン反映処理です。
        // 他バリデーションと共存するため、bays 用フラグだけを管理します。
        const applyBaysRiskToSaveButton = (riskBlocked) => {
            saveAdvancedSettingsBtn.dataset.baysRiskBlocked = riskBlocked ? 'true' : 'false';
            if (riskBlocked) {
                saveAdvancedSettingsBtn.disabled = true;
                saveAdvancedSettingsBtn.textContent = '全端末共通設定を保存できません';
                return;
            }
            if (saveAdvancedSettingsBtn.dataset.otherValidationBlocked === 'true') return;
            if (saveAdvancedSettingsBtn.dataset.globalLoadBlocked === 'true') return;
            saveAdvancedSettingsBtn.disabled = false;
            saveAdvancedSettingsBtn.textContent = '全端末共通のレイアウト設定を保存';
        };

        const refreshBaysRiskUi = () => {
            const risk = buildBaysReductionRisk(stateMgr.state, settingBays.value);
            if (!risk.isReduction) {
                settingBaysRiskNotice.classList.add('hidden');
                applyBaysRiskToSaveButton(false);
                return;
            }

            const affectedRangeText = `No.${risk.affectedBayStart}〜No.${risk.affectedBayEnd}`;
            const slotList = risk.activeSlots.map((item) => item.slotKey).join(', ');
            const activeBayCount = new Set(risk.activeSlots.map((item) => item.bay)).size;

            settingBaysRiskNotice.classList.remove('hidden');
            if (risk.blocked) {
                settingBaysRiskNotice.style.background = 'rgba(127, 29, 29, 0.2)';
                settingBaysRiskNotice.style.border = '1px solid rgba(248, 113, 113, 0.75)';
                settingBaysRiskNotice.style.color = '#fecaca';
                if (risk.reason === 'loading') {
                    settingBaysRiskNotice.innerHTML = `⚠️ 縮小対象: ${affectedRangeText}<br>状態を読み込み中のため、いまは保存できません。`;
                } else {
                    settingBaysRiskNotice.innerHTML = `⚠️ 縮小対象: ${affectedRangeText}<br>投入済み間口: ${activeBayCount} 件<br>問題のある論理間口: ${slotList}`;
                }
                applyBaysRiskToSaveButton(true);
                return;
            }

            settingBaysRiskNotice.style.background = 'rgba(30, 41, 59, 0.45)';
            settingBaysRiskNotice.style.border = '1px solid rgba(148, 163, 184, 0.55)';
            settingBaysRiskNotice.style.color = '#cbd5e1';
            settingBaysRiskNotice.innerHTML = `ℹ️ 縮小対象: ${affectedRangeText}<br>投入済み間口: 0 件<br>対象間口に投入済みデータはありません。`;
            applyBaysRiskToSaveButton(false);
        };

        const getOptimisticMeta = (slotKey) => {
            return stateMgr.localUiState.optimisticSlots?.[slotKey]?._meta || null;
        };

        const getOptimisticPickCompletion = (slotKey, state) => {
            const completion = stateMgr.localUiState.optimisticPickCompletions?.[slotKey] || null;
            if (!completion) return null;
            const currentUserState = state.userStates?.[stateMgr.currentUserId] || {};
            const activeListId = currentUserState.currentPickingNo || null;
            if (!activeListId || String(activeListId) !== String(completion.listId)) return null;
            return completion;
        };

        const isPickProcessing = (slotKey, state) => !!getOptimisticPickCompletion(slotKey, state);

        const getActiveDuplicateHighlight = (state) => {
            return stateMgr.getActiveDuplicateHighlightForUser(state, stateMgr.currentUserId);
        };

        const getDenseActive = (splitCount) => {
            const deviceSettings = getDeviceWallSettings();
            return deviceSettings.denseTextMode !== false && splitCount >= 5;
        };

        const escapeHtml = (value) => String(value ?? '').replace(/[&<>\"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[ch]));
        const normalizeDisplayText = (value) => String(value ?? '').replace(/^[\s　]+|[\s　]+$/g, '');
        const getProductLabel = (state, jan) => normalizeDisplayText(state?.productInfo?.[jan]?.productLabel);

        const renderStackedBlock = (blockEl, labelText, qtyText, subLabel = '') => {
            blockEl.innerHTML = `
                <div class="block-content">
                    <span class="block-main-label">${escapeHtml(labelText || '')}</span>
                    ${subLabel ? `<span class="block-sub-label">${escapeHtml(subLabel)}</span>` : ''}
                    <span class="block-qty">${escapeHtml(qtyText || '')}</span>
                </div>
            `;
        };

        const collectUnallocatedItems = (state) => {
            const injectList = state.injectList || {};
            const mergedSlots = getMergedSlots(state);
            const allocatedSkus = new Set();

            Object.values(mergedSlots).forEach(slot => {
                const skus = getSlotSkus(slot);
                skus.forEach(jan => allocatedSkus.add(String(jan)));
            });

            return Object.keys(injectList)
                .filter(jan => !allocatedSkus.has(String(jan)))
                .sort((a, b) => a.localeCompare(b))
                .map(jan => ({
                    jan,
                    qty: Number(injectList[jan]) || 0,
                    productLabel: getProductLabel(state, jan)
                }));
        };

        const renderPickBlock = (blockEl, primaryText, qtyText, subLabel = '') => {
            blockEl.innerHTML = `
                <div class="block-content">
                    <span class="block-main-label">${escapeHtml(primaryText || '')}</span>
                    ${subLabel ? `<span class="block-sub-label">${escapeHtml(subLabel)}</span>` : ''}
                    <span class="block-qty">${escapeHtml(qtyText || '')}</span>
                </div>
            `;
        };

        const formatJanLast4 = (jan) => {
            const janText = String(jan || '');
            return janText ? `...${janText.slice(-4)}` : '';
        };

        const showSlotSkusModal = (b, s, skus, stateMgr, state) => {
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
            modal.style.width = 'min(420px, calc(100vw - 24px))';
            modal.style.maxWidth = '90%';
            modal.style.boxSizing = 'border-box';
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
                const requiredQty = Number(state?.injectList?.[jan]) || 0;
                const productLabel = getProductLabel(state, jan);
                const janLabel = productLabel ? formatJanLast4(jan) : jan;
                const item = document.createElement('div');
                item.style.display = 'flex';
                item.style.justifyContent = 'space-between';
                item.style.alignItems = 'center';
                item.style.background = '#334155';
                item.style.padding = '0.75rem';
                item.style.borderRadius = '6px';
                
                item.innerHTML = `
                    <div style="display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; margin-right:0.75rem;">
                        ${productLabel ? `<span style="font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(productLabel)}</span>` : ''}
                        <span style="font-family:monospace; font-weight:700; color:${productLabel ? '#94a3b8' : 'white'}; font-size:${productLabel ? '0.8rem' : '1rem'}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(janLabel)}</span>
                    </div>
                    <span style="font-size:0.75rem; color:#94a3b8; flex:0 0 auto; text-align:right; margin-right:0.75rem;">必要 <strong style="color:white; font-size:1rem;">${escapeHtml(requiredQty)}</strong></span>
                    <button class="btn btn-danger remove-sku-btn" data-jan="${escapeHtml(jan)}" style="padding:0.25rem 0.75rem; font-size:0.8rem; flex:0 0 auto;">解除</button>
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

        const showUnallocatedSkusModal = (state) => {
            let overlay = document.getElementById('unallocatedSkusOverlay');
            if (overlay) overlay.remove();

            const items = collectUnallocatedItems(state);
            const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
            const totalBaysForOther = getValidBaysOrBlock(state, null);
                if (totalBaysForOther === null) return;
                const nextBayNo = totalBaysForOther + 1;

            overlay = document.createElement('div');
            overlay.id = 'unallocatedSkusOverlay';
            overlay.className = 'overlay';
            overlay.style.position = 'fixed';
            overlay.style.inset = '0';
            overlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '1000';
            overlay.onclick = () => overlay.remove();

            const modal = document.createElement('div');
            modal.style.background = '#1e293b';
            modal.style.padding = '2rem';
            modal.style.borderRadius = '12px';
            modal.style.width = 'min(420px, calc(100vw - 24px))';
            modal.style.maxWidth = '90%';
            modal.style.maxHeight = '80vh';
            modal.style.boxSizing = 'border-box';
            modal.style.color = 'white';
            modal.style.display = 'flex';
            modal.style.flexDirection = 'column';
            modal.style.gap = '0.75rem';
            modal.onclick = (e) => e.stopPropagation();

            modal.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin:0;">No.${nextBayNo} その他（未割り当て）</h3>
                    <button class="btn btn-outline close-btn" style="padding:4px 8px;">✕</button>
                </div>
                <div style="color:#cbd5e1; font-weight:700;">${items.length} SKU / 合計 ${totalQty} 個</div>
                <div id="unallocatedList" style="display:flex; flex-direction:column; gap:0.5rem; overflow-y:auto; max-height:60vh;"></div>
            `;

            const listContainer = modal.querySelector('#unallocatedList');
            if (items.length === 0) {
                listContainer.innerHTML = '<div style="color:#94a3b8; text-align:center; padding:0.5rem 0;">未割り当てSKUはありません</div>';
            } else {
                items.forEach(({ jan, qty, productLabel }) => {
                    const row = document.createElement('div');
                    row.style.display = 'flex';
                    row.style.justifyContent = 'space-between';
                    row.style.alignItems = 'center';
                    row.style.background = '#334155';
                    row.style.padding = '0.75rem';
                    row.style.borderRadius = '6px';
                    const janLabel = jan;
                    row.innerHTML = `
                        <div style="display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; margin-right:0.75rem;">
                            ${productLabel ? `<span style="font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(productLabel)}</span>` : '<span style="font-size:0.72rem; color:#94a3b8; font-weight:700;">JAN</span>'}
                            <span style="font-family:monospace; font-weight:700; color:${productLabel ? '#94a3b8' : 'white'}; font-size:${productLabel ? '0.8rem' : '1rem'}; overflow:hidden; white-space:nowrap;">${escapeHtml(janLabel)}</span>
                        </div>
                        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px; flex:0 0 auto;">
                            <span style="font-size:0.72rem; color:#94a3b8; font-weight:700;">数量</span>
                            <span style="font-weight:900; font-size:1.1rem;">${escapeHtml(qty)}</span>
                        </div>
                    `;
                    listContainer.appendChild(row);
                });
            }

            modal.querySelector('.close-btn').onclick = () => overlay.remove();
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        };

        const getVerifyConfig = (state = stateMgr.state) => {
            const cfg = state?.config || {};
            return {
                pickMode: cfg.pickMode === 'VERIFY' ? 'VERIFY' : 'NORMAL'
            };
        };

        const setScannerStatus = (text) => {
            if (scannerStatusLabel) scannerStatusLabel.textContent = text || '';
        };

        const setScannerResult = (text, isError = false) => {
            if (!scannerResultLabel) return;
            scannerResultLabel.textContent = text || '';
            scannerResultLabel.style.color = isError ? '#fca5a5' : '#fef3c7';
        };

        const stopScanner = (options = {}) => {
            const preserveStatus = !!options.preserveStatus;
            scannerRunning = false;
            if (scannerTimer) {
                clearTimeout(scannerTimer);
                scannerTimer = null;
            }
            if (scannerStream) {
                scannerStream.getTracks().forEach((track) => track.stop());
                scannerStream = null;
            }
            if (scannerPreview) {
                scannerPreview.pause();
                scannerPreview.srcObject = null;
                scannerPreview.classList.add('hidden');
            }
            if (scannerToggleBtn) scannerToggleBtn.textContent = '📷 開始';
            if (!preserveStatus) {
                setScannerStatus('待機中');
            }
        };

        const consumeScannedJan = async (jan) => {
            const code = stateMgr.normalizeJanValue(jan);
            if (!code) return;
            const now = Date.now();
            if (lastScannedJan === code && now - lastScannedAt < 800) return;
            lastScannedJan = code;
            lastScannedAt = now;

            const currentUserState = stateMgr.state?.userStates?.[stateMgr.currentUserId] || {};
            const listId = currentUserState.currentPickingNo;
            if (!listId) {
                setScannerResult('先にピッキングNo.を開始してください', true);
                AudioManager.playErrorSound();
                return;
            }
            try {
                const result = await stateMgr.consumePickByJan(listId, code);
                if (result?.result === 'done') {
                    setScannerResult(`...${code.slice(-4)} 完了`);
                    AudioManager.playStartSound();
                } else if (result?.result === 'partial') {
                    const line = result.line || {};
                    setScannerResult(`...${code.slice(-4)} OK (${line.checkedQty}/${line.qty})`);
                    AudioManager.playStartSound();
                } else if (result?.result === 'already_done') {
                    setScannerResult('既に完了済みです', true);
                    AudioManager.playErrorSound();
                } else {
                    setScannerResult('このピッキングNo.の対象外です', true);
                    AudioManager.playErrorSound();
                }
            } catch (error) {
                console.error('consumeScannedJan failed', error);
                setScannerResult('JAN処理に失敗しました', true);
                AudioManager.playErrorSound();
            }
        };

        const scanLoop = async () => {
            if (!scannerRunning || !barcodeDetector || !scannerPreview || scannerPreview.readyState < 2) {
                scannerTimer = setTimeout(scanLoop, 200);
                return;
            }
            try {
                const barcodes = await barcodeDetector.detect(scannerPreview);
                if (Array.isArray(barcodes) && barcodes.length > 0) {
                    await consumeScannedJan(barcodes[0]?.rawValue || '');
                }
            } catch (error) {
                // no-op
            }
            scannerTimer = setTimeout(scanLoop, 120);
        };

        const startScanner = async () => {
            if (scannerRunning) return;
            if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
                setScannerStatus('この端末ではカメラ読取を利用できません');
                return;
            }
            try {
                barcodeDetector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
                const facingMode = cameraFacingSelect?.value || 'environment';
                scannerStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: facingMode } },
                    audio: false
                });
                scannerPreview.srcObject = scannerStream;
                scannerPreview.classList.remove('hidden');
                await scannerPreview.play();
                scannerRunning = true;
                if (scannerToggleBtn) scannerToggleBtn.textContent = '🛑 停止';
                setScannerStatus('読取中');
                setScannerResult('');
                scanLoop();
            } catch (error) {
                console.error('startScanner failed', error);
                stopScanner({ preserveStatus: true });
                setScannerStatus('カメラ起動に失敗しました');
                setScannerResult('権限または端末設定を確認してください', true);
            }
        };

        const markSlotDone = async (slotKey, state, stateMgr) => {
            const currentUserState = state.userStates?.[stateMgr.currentUserId] || {};
            const listId = currentUserState.currentPickingNo;
            if (!listId) return;
            const activePickCount = Object.values(currentUserState.activePick || {}).filter((entry) => (Number(entry?.pendingQty) || 0) > 0).length;
            const tapStart = performance.now();
            perf?.mark('wall.pick.tap.start', { currentPickingNo: listId, slotKey, activePickCount, elapsedMs: 0 });
            if (stateMgr.isOptimisticPickCompletionActive(slotKey, state)) {
                perf?.mark('wall.pick.tap.ignored', { currentPickingNo: listId, slotKey, activePickCount, elapsedMs: Math.round(performance.now() - tapStart) });
                return;
            }
            const opId = stateMgr.setOptimisticPickCompletion(slotKey, listId);
            perf?.mark('wall.pick.optimistic.set', { currentPickingNo: listId, slotKey, activePickCount, elapsedMs: Math.round(performance.now() - tapStart) });
            if (!opId) return;
            AudioManager.playStartSound();
            try {
                perf?.mark('wall.pick.complete.before', { currentPickingNo: listId, slotKey, activePickCount, elapsedMs: Math.round(performance.now() - tapStart) });
                await stateMgr.completePickBySlot(listId, slotKey);
                stateMgr.markOptimisticPickCompletionCommitted(slotKey, opId);
                perf?.mark('wall.pick.complete.after', { currentPickingNo: listId, slotKey, activePickCount, elapsedMs: Math.round(performance.now() - tapStart) });
            } catch (error) {
                console.error('ピッキング完了処理に失敗しました:', error);
                stateMgr.clearOptimisticPickCompletion(slotKey, opId);
                stateMgr.setTransientWallError(slotKey, '通信失敗。もう一度タップしてください');
                AudioManager.playErrorSound();
                perf?.mark('wall.pick.complete.failed', { currentPickingNo: listId, slotKey, activePickCount, elapsedMs: Math.round(performance.now() - tapStart), message: error?.message || String(error) });
            }
        };

        const getIndicators = (state, slotKey) => {
            const config = getEffectiveWallConfig(state);
            const showOthers = config.showOthers !== false;
            const indicators = [];

            const userStates = state.userStates || {};
            Object.keys(userStates).forEach(uId => {
                const uIdx = uId.slice(-1);
                const isMe = uId === stateMgr.currentUserId;
                if (!isMe && !showOthers) return;

                const uState = userStates[uId];
                
                // Picking Indicator
                const pickData = uState.activePick?.[slotKey];
                if (pickData && pickData.pendingQty > 0) {
                    indicators.push({ type: 'PICK', uId, uIdx, colorIdx: uIdx, qty: pickData.pendingQty, isMe });
                }

                // Injection Indicator
                const injectPending = uState.injectPending;
                if (injectPending && injectPending.status === 'WAITING_SLOT') {
                    // If we want to show which slot is being targeted for injection, 
                    // we need to know if this slot was the one scanned/selected.
                    // For now, if it's "WAITING_SLOT", we show it on all configured slots
                    // OR if we implement a specific targetSlot field in injectPending.
                }
            });
            return indicators;
        };

        const renderBayContent = (b, state, isSingleView = false) => {
            const isConfigured = state.splits?.[b] !== undefined;
            const splitCount = isConfigured ? state.splits[b] : 1;
            const orientation = state.config?.orientation || 'portrait';
            const denseEnabled = getDenseActive(splitCount);
            
            const currentUserState = state.userStates?.[stateMgr.currentUserId] || {};
            const myActivePick = currentUserState.activePick || {};
            const isUserPickingAnywhere = Object.values(myActivePick).some(p => p.pendingQty > 0);
            const duplicateHighlight = getActiveDuplicateHighlight(state);
            const effectivePending = stateMgr.getEffectiveInjectPendingForCurrentUser(state);
            const firestorePending = currentUserState.injectPending || null;
            const firestorePendingRequestId = firestorePending?.requestId || null;
            const firestorePendingCancelledLocally = stateMgr.isInjectRequestCancelled(firestorePendingRequestId);
            const remoteCancelled = currentUserState.injectPendingCancelled || null;
            const remoteCancelledMatches =
                !!firestorePending &&
                !!remoteCancelled &&
                !!remoteCancelled.requestId &&
                remoteCancelled.requestId === firestorePending.requestId;
            const pendingSuppressed = firestorePendingCancelledLocally || remoteCancelledMatches;

            const isInjectWaitingUi =
                state.mode === 'INJECT' &&
                !pendingSuppressed &&
                effectivePending?.status === 'WAITING_SLOT';

            const isInjectReady =
                state.mode === 'INJECT' &&
                !pendingSuppressed &&
                effectivePending &&
                effectivePending.status === 'WAITING_SLOT' &&
                firestorePending &&
                firestorePending.status === 'WAITING_SLOT' &&
                isConfigured;
            const isInjectSyncing =
                state.mode === 'INJECT' &&
                !pendingSuppressed &&
                isInjectWaitingUi &&
                !isInjectReady;

            const screen = document.createElement('div');
            screen.className = 'mobile-screen';
            screen.innerHTML = `
                <div class="screen-header">
                    <span>No.${b}</span>
                    <span class="live-badge">● LIVE</span>
                </div>
            `;

            const body = document.createElement('div');
            body.className = `screen-body ${getGridClass(splitCount, orientation)}`;
            const mergedSlots = getMergedSlots(state);
            const isDuplicateFocusActive = !!duplicateHighlight?.slotKey;
            const clearDuplicateHighlightIfMatched = (slotKey) => {
                if (duplicateHighlight?.slotKey !== slotKey) return;
                stateMgr.clearDuplicateHighlight({ slotKey }).catch((error) => {
                    console.error('duplicateHighlight の解除に失敗しました:', error);
                });
            };

            for (let s = 1; s <= splitCount; s++) {
                const slotKey = `${b}-${s}`;
                const slotData = mergedSlots[slotKey];
                
                const indicators = getIndicators(state, slotKey);
                const myPickData = myActivePick[slotKey];
                const isTargetForMe = myPickData && myPickData.pendingQty > 0;
                const processingPickCompletion = getOptimisticPickCompletion(slotKey, state);
                const isPickCompletionProcessing = !!processingPickCompletion;
                const isDuplicateTargetSlot = duplicateHighlight?.slotKey === slotKey;
                const shouldGrayOutByPick = isUserPickingAnywhere && !isTargetForMe;
                const shouldGrayOutByDuplicate = isDuplicateFocusActive && !isDuplicateTargetSlot;

                const block = document.createElement('div');
                block.className = 'block';
                if (denseEnabled) block.classList.add('is-dense');
                const optimisticMeta = getOptimisticMeta(slotKey);
                if (optimisticMeta?.status === 'pending') block.classList.add('optimistic-pending');
                if (optimisticMeta?.status === 'committed') block.classList.add('optimistic-committed');
                if (duplicateHighlight?.slotKey === slotKey) block.classList.add('wall-duplicate-highlight');
                if (!isPickCompletionProcessing && (shouldGrayOutByPick || shouldGrayOutByDuplicate)) {
                    block.classList.add('grayed-out');
                }

                const placement = getSlotPlacement(splitCount, s, orientation);
                if (placement?.row) block.style.gridRow = placement.row;
                if (placement?.column) block.style.gridColumn = placement.column;

                const skus = slotData ? (slotData.skus || (slotData.sku ? [slotData.sku] : [])) : [];
                const isMultiSkuSlot = skus.length >= 2;
                const targetSkus = Array.isArray(myPickData?.skus) ? myPickData.skus : [];
                const targetSkuCount = targetSkus.length;
                const targetJan = targetSkuCount === 1 ? targetSkus[0] : null;
                const isMultiSlotSingleTarget = isMultiSkuSlot && targetSkuCount === 1;
                const isMultiTargetPick = targetSkuCount >= 2;
                const normalPickColor = getPickColor(s);
                const multiSkuColor = '#ef4444';
                const slotPickColor = isMultiSkuSlot ? multiSkuColor : normalPickColor;
                if (isMultiSkuSlot) block.classList.add('multi-sku-slot');

                if (isPickCompletionProcessing) {
                    block.classList.add('pick-processing');
                    const processingQty = myPickData?.pendingQty || myPickData?.totalQty || 0;
                    const processingSkuCount = targetSkuCount || skus.length || 0;
                    const processingLabel = processingSkuCount > 0
                        ? `処理中 ${processingSkuCount} SKU`
                        : '処理中';
                    renderPickBlock(block, processingLabel, processingQty > 0 ? `${processingQty}` : '...');
                    block.style.setProperty('--pick-color', slotPickColor);
                    block.style.cursor = 'wait';
                    block.onclick = null;
                } else if (indicators.length > 0) {
                    const myInd = indicators.find(ind => ind.isMe);
                    if (myInd && myInd.type === 'PICK') {
                        block.classList.add('picking');
                        block.classList.add(`pulse-user-${stateMgr.currentUserId.slice(-1)}`);
                        if (isMultiSlotSingleTarget) {
                            renderPickBlock(block, formatJanLast4(targetJan), `${myPickData.pendingQty}`, '他SKUあり');
                        } else if (isMultiTargetPick) {
                            const multiTargetLabel = denseEnabled ? `${targetSkuCount} SKU` : `対象 ${targetSkuCount} SKU`;
                            renderPickBlock(block, multiTargetLabel, `${myPickData.pendingQty}`, '複数SKU');
                        } else {
                            const pickLabel = skus.length === 1 ? formatJanLast4(skus[0]) : (denseEnabled ? `${targetSkuCount} SKU` : `対象: ${targetSkuCount} SKU`);
                            renderStackedBlock(block, pickLabel, `${myPickData.pendingQty}`);
                        }
                        block.onclick = async (e) => {
                            e.stopPropagation();
                            clearDuplicateHighlightIfMatched(slotKey);
                            await markSlotDone(slotKey, state, stateMgr);
                        };
                    } else {
                        // Show multi-user indicators
                        const indContainer = document.createElement('div');
                        indContainer.className = 'indicator-container';
                        indicators.forEach(ind => {
                            const dot = document.createElement('div');
                            dot.className = `user-dot user-dot-${ind.uIdx}`;
                            dot.textContent = ind.uIdx;
                            indContainer.appendChild(dot);
                        });
                        block.appendChild(indContainer);

                        const primaryInd = indicators[0];
                        block.classList.add(`pulse-user-${primaryInd.colorIdx}`);
                        
                        const infoDiv = document.createElement('div');
                        infoDiv.className = 'block-main-label';
                        infoDiv.style.marginTop = 'auto';
                        if (skus.length > 0) {
                            infoDiv.textContent = skus.length === 1 ? "..." + skus[0].slice(-4) : `${skus.length} SKU`;
                        } else {
                            infoDiv.textContent = s;
                        }
                        block.appendChild(infoDiv);
                    }
                    block.style.setProperty('--pick-color', slotPickColor);
                } else if (myPickData && myPickData.pendingQty === 0) {
                    block.classList.add('picking-done');
                    if (isMultiSlotSingleTarget) {
                        renderPickBlock(block, formatJanLast4(targetJan), `${myPickData.totalQty}`, '他SKUあり');
                    } else if (isMultiTargetPick) {
                        const doneLabel = denseEnabled ? `${targetSkuCount} SKU` : `完了 ${targetSkuCount} SKU`;
                        renderPickBlock(block, doneLabel, `${myPickData.totalQty}`, '複数SKU');
                    } else {
                        const doneLabel = skus.length === 1 ? formatJanLast4(skus[0]) : (denseEnabled ? `完了 ${targetSkuCount} SKU` : `完了済: ${targetSkuCount} SKU`);
                        renderStackedBlock(block, doneLabel, `${myPickData.totalQty}`);
                    }
                    block.style.setProperty('--pick-color', slotPickColor);
                } else if (skus.length > 0) {
                    block.classList.add('filled');
                    block.style.cursor = 'pointer';
                    block.onclick = (e) => {
                        e.stopPropagation();
                        clearDuplicateHighlightIfMatched(slotKey);
                        if (isInjectReady) stateMgr.selectSlot(b, s);
                        else showSlotSkusModal(b, s, skus, stateMgr, state);
                    };
                    if (skus.length === 1) {
                        const jan = skus[0];
                        const totalQty = state.injectList?.[jan] || 0;
                        const productLabel = getProductLabel(state, jan);
                        const label = productLabel || formatJanLast4(jan);
                        const subLabel = productLabel ? formatJanLast4(jan) : '';
                        renderStackedBlock(block, label, `${totalQty}`, subLabel);
                    } else {
                        const totalQty = skus.reduce((sum, jan) => sum + (state.injectList?.[jan] || 0), 0);
                        renderStackedBlock(block, `${skus.length} SKU`, totalQty > 0 ? `${totalQty}` : '');
                    }
                    block.style.setProperty('--pick-color', slotPickColor);
                } else if (isInjectReady) {
                    block.classList.add('inject-ready');
                    block.textContent = 'TAP';
                    block.style.setProperty('--pick-color', '#3b82f6');
                    block.onclick = (e) => {
                        e.stopPropagation();
                        clearDuplicateHighlightIfMatched(slotKey);
                        stateMgr.selectSlot(b, s);
                    };
                } else if (isInjectSyncing && isConfigured) {
                    block.classList.add('grayed-out');
                    block.textContent = '同期中';
                } else {
                    block.textContent = s;
                }
                body.appendChild(block);
            }
            screen.appendChild(body);

            // Controls (Inject Mode Setup)
            if (state.mode === 'INJECT' && !isInjectWaitingUi) {
                if (!isConfigured) {
                    const setup = document.createElement('div');
                    setup.className = 'setup-needed';
                    setup.innerHTML = `
                        <div style="font-weight:800; font-size:0.75rem; color:${isInjectWaitingUi ? '#f87171' : 'white'}; margin-bottom:8px;">未設定</div>
                        <button class="btn-setup">初期化</button>
                    `;
                    setup.querySelector('.btn-setup').onclick = () => stateMgr.update({ [`splits.${b}`]: 1 });
                    screen.appendChild(setup);
                } else {
                    const controls = document.createElement('div');
                    controls.className = 'config-overlay';
                    controls.style.display = 'flex';
                    controls.style.gap = '8px';

                    const minusBtn = document.createElement('button');
                    minusBtn.className = 'btn-round';
                    minusBtn.innerHTML = '－';
                    minusBtn.style.fontSize = '14px';
                    minusBtn.style.background = 'rgba(0, 0, 0, 0.6)';
                    const splitRisk = buildSplitReductionRisk(state, b, splitCount - 1);
                    if (splitCount <= 1 || splitRisk.blocked) {
                        minusBtn.classList.add('disabled');
                        minusBtn.title = splitRisk.blocked ? getSplitReductionBlockedTitle(splitRisk) : '';
                    } else {
                        minusBtn.onclick = (e) => {
                            e.stopPropagation();
                            const latestSplitCount = stateMgr.state?.splits?.[b] || splitCount;
                            const latestRisk = buildSplitReductionRisk(stateMgr.state, b, latestSplitCount - 1);
                            if (latestRisk.blocked) {
                                alert(buildSplitReductionBlockedMessage(latestRisk));
                                return;
                            }
                            stateMgr.update({ [`splits.${b}`]: latestSplitCount - 1 });
                        };
                    }
                    controls.appendChild(minusBtn);

                    const plusBtn = document.createElement('button');
                    plusBtn.className = 'btn-round';
                    plusBtn.innerHTML = '＋';
                    plusBtn.style.fontSize = '14px';
                    plusBtn.style.background = 'rgba(0, 0, 0, 0.6)';
                    const maxSplit = 6;
                    if (splitCount >= maxSplit) {
                        plusBtn.classList.add('disabled');
                    } else {
                        plusBtn.onclick = (e) => {
                            e.stopPropagation();
                            stateMgr.update({ [`splits.${b}`]: splitCount + 1 });
                        };
                    }
                    controls.appendChild(plusBtn);

                    const editBtn = document.createElement('button');
                    editBtn.className = 'btn-round';
                    editBtn.innerHTML = '⚙️';
                    editBtn.style.fontSize = '14px';
                    editBtn.style.background = 'rgba(0, 0, 0, 0.6)';
                    editBtn.onclick = (e) => {
                        e.stopPropagation();
                        showBayEditMenu(b, state);
                    };
                    controls.appendChild(editBtn);
                    screen.appendChild(controls);
                }
            }

            return screen;
        };

        const renderBay10 = (state) => {
            const unallocatedItems = collectUnallocatedItems(state);
            const totalBaysForOther = getValidBaysOrBlock(state, null);
                if (totalBaysForOther === null) return;
                const nextBayNo = totalBaysForOther + 1;
            const unallocatedCount = unallocatedItems.length;
            const currentUserState = state.userStates?.[stateMgr.currentUserId] || {};
            const myActivePick = currentUserState.activePick || {};
            const isUserPickingAnywhere = Object.values(myActivePick).some(p => p.pendingQty > 0);
            const duplicateHighlight = getActiveDuplicateHighlight(state);

            const indicators = getIndicators(state, 'UNALLOCATED');
            const myPick = indicators.find(ind => ind.isMe);
            const isTargetForMe = myPick && myPick.qty > 0;
            const isAnyPick = indicators.length > 0;
            const isDone = myPick && myPick.qty === 0;
            const unallocatedProcessing = isPickProcessing('UNALLOCATED', state);

            const shouldGrayOutByDuplicate = !!duplicateHighlight?.slotKey && duplicateHighlight.slotKey !== 'UNALLOCATED';
            const blackoutClass = unallocatedProcessing
                ? ''
                : (((isUserPickingAnywhere && !isTargetForMe) || shouldGrayOutByDuplicate) ? 'grayed-out' : '');
            const bgColor = unallocatedProcessing
                ? '#334155'
                : (myPick ? (isDone ? '#000000' : '#ca8a04') : (isAnyPick ? '#334155' : '#1e293b'));
            const borderColor = unallocatedProcessing ? '#94a3b8' : (isAnyPick ? '#eab308' : '#334155');

            bay10Container.innerHTML = `
                <div class="mobile-screen ${blackoutClass}" style="flex-direction: row; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; border: 1px solid ${borderColor}; border-radius: 6px; background: ${bgColor}; color: white; position: relative;">
                    <div style="display: flex; flex-direction: column;">
                        <span style="color: #94a3b8; font-size: 0.7rem; font-weight: 800;">No.${nextBayNo}</span>
                        <span style="font-size: 1.1rem; font-weight: 800;">その他（未割り当て）</span>
                    </div>
                    <div style="display: flex; align-items: baseline; gap: 6px;">
                        ${unallocatedProcessing
                            ? '<span style="font-size: 1rem; font-weight: 800; background: rgba(148, 163, 184, 0.25); border: 2px solid #94a3b8; color: #e2e8f0; padding: 2px 8px; border-radius: 12px; margin-right: 4px;">処理中</span>'
                            : (myPick ? `<span style="font-size: 1rem; font-weight: 800; background: ${isDone ? 'transparent' : '#fef08a'}; border: ${isDone ? '2px solid #ca8a04' : 'none'}; color: ${isDone ? '#ca8a04' : '#854d0e'}; padding: 2px 8px; border-radius: 12px; margin-right: 4px;">${isDone ? '完了' : 'PICK対象'}</span>` : '')}
                        <span style="color: ${isAnyPick ? 'white' : '#f59e0b'}; font-size: 2rem; font-weight: 800; line-height: 1;">${unallocatedCount}</span>
                        <span style="color: #94a3b8; font-size: 0.8rem; font-weight: 800;">SKU</span>
                    </div>
                    <div class="indicator-container" style="top:2px; right:2px;">
                        ${indicators.map(ind => `<div class="user-dot user-dot-${ind.uIdx}">${ind.uIdx}</div>`).join('')}
                    </div>
                </div>
            `;
            const bay10Screen = bay10Container.querySelector('.mobile-screen');
            if (bay10Screen) {
                bay10Screen.style.cursor = 'pointer';
                bay10Screen.onclick = async (e) => {
                    e.stopPropagation();
                    if (unallocatedProcessing) return;
                    if (myPick && myPick.qty > 0) {
                        await markSlotDone('UNALLOCATED', state, stateMgr);
                    } else {
                        showUnallocatedSkusModal(state);
                    }
                };
            }
            bay10Container.classList.remove('hidden');
        };

        // --- Main Render Logic ---

        const renderUnallocatedDetail = (state) => {
            const unallocatedItems = collectUnallocatedItems(state);
            const skuCount = unallocatedItems.length;
            const totalQty = unallocatedItems.reduce((sum, item) => sum + item.qty, 0);

            const container = document.createElement('div');
            container.className = 'mobile-screen';
            const totalBaysForOther = getValidBaysOrBlock(state, null);
                if (totalBaysForOther === null) return;
                const nextBayNo = totalBaysForOther + 1;
            const indicators = getIndicators(state, 'UNALLOCATED');
            const isAnyPick = indicators.length > 0;

            container.innerHTML = `
                <div class="screen-header">
                    <span>No.${nextBayNo} (その他)</span>
                    <span class="live-badge">● LIVE</span>
                </div>
            `;

            const currentUserState = state.userStates?.[stateMgr.currentUserId] || {};
            const myActivePick = currentUserState.activePick || {};
            const isUserPickingAnywhere = Object.values(myActivePick).some(p => p.pendingQty > 0);
            const pickUnallocated = myActivePick['UNALLOCATED'];
            const isPickContext = Boolean(pickUnallocated);
            const hasPending = Boolean(isPickContext && pickUnallocated.pendingQty > 0);
            const displaySkuCount = isPickContext ? (pickUnallocated.skus?.length || 0) : skuCount;
            const displayQty = isPickContext
                ? (hasPending ? pickUnallocated.pendingQty : pickUnallocated.totalQty)
                : totalQty;
            const myPickIndicator = indicators.find(ind => ind.isMe);
            const isTargetForMe = hasPending || Boolean(myPickIndicator && myPickIndicator.qty > 0);
            const duplicateHighlight = getActiveDuplicateHighlight(state);
            const unallocatedProcessing = isPickProcessing('UNALLOCATED', state);
            const shouldGrayOutByDuplicate = !!duplicateHighlight?.slotKey && duplicateHighlight.slotKey !== 'UNALLOCATED';

            const body = document.createElement('div');
            body.className = 'screen-body grid-split-1';

            const block = document.createElement('div');
            block.className = 'block';
            if (!unallocatedProcessing && ((isUserPickingAnywhere && !isTargetForMe) || shouldGrayOutByDuplicate)) {
                block.classList.add('grayed-out');
            }

            if (unallocatedProcessing) {
                block.classList.add('pick-processing');
                block.style.flexDirection = 'column';
                block.innerHTML = `
                    <div style="font-size: 0.5em; font-weight: 800; opacity: 0.95; line-height: 1; padding-bottom: 4px;">処理中</div>
                    <div style="line-height: 1; font-weight: 900;">${displayQty} 個</div>
                `;
                block.style.setProperty('--pick-color', '#94a3b8');
            } else if (isPickContext) {
                block.style.flexDirection = 'column';
                if (hasPending) {
                    block.classList.add('picking');
                    block.innerHTML = `
                        <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">対象: ${displaySkuCount} SKU</div>
                        <div style="line-height: 1; font-weight: 900;">${displayQty} 個</div>
                    `;
                    block.style.setProperty('--pick-color', '#eab308');
                    block.onclick = async (e) => {
                        e.stopPropagation();
                        await markSlotDone('UNALLOCATED', state, stateMgr);
                    };
                } else {
                    block.classList.add('picking-done');
                    block.innerHTML = `
                        <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">完了済: ${displaySkuCount} SKU</div>
                        <div style="line-height: 1; font-weight: 900;">${displayQty} 個</div>
                    `;
                    block.style.setProperty('--pick-color', '#eab308');
                }
                const indContainer = document.createElement('div');
                indContainer.className = 'indicator-container';
                indicators.forEach(ind => {
                    const dot = document.createElement('div');
                    dot.className = `user-dot user-dot-${ind.uIdx}`;
                    dot.textContent = ind.uIdx;
                    indContainer.appendChild(dot);
                });
                block.appendChild(indContainer);
            } else if (isAnyPick) {
                block.style.flexDirection = 'column';
                const primaryInd = indicators[0];
                block.classList.add(`pulse-user-${primaryInd.colorIdx}`);
                block.innerHTML = `
                    <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">他ユーザー作業中</div>
                    <div style="line-height: 1; font-weight: 900;">${skuCount} SKU</div>
                `;
                const indContainer = document.createElement('div');
                indContainer.className = 'indicator-container';
                indicators.forEach(ind => {
                    const dot = document.createElement('div');
                    dot.className = `user-dot user-dot-${ind.uIdx}`;
                    dot.textContent = ind.uIdx;
                    indContainer.appendChild(dot);
                });
                block.appendChild(indContainer);
            } else if (skuCount > 0) {
                block.classList.add('filled');
                block.style.flexDirection = 'column';
                block.innerHTML = `
                    <div style="font-size: 0.5em; font-weight: 800; opacity: 0.9; line-height: 1; padding-bottom: 4px;">${skuCount} SKU</div>
                    <div style="line-height: 1; font-weight: 900;">${totalQty} 個</div>
                `;
                block.style.setProperty('--pick-color', '#334155');
                block.style.cursor = 'pointer';
                block.onclick = (e) => {
                    e.stopPropagation();
                    showUnallocatedSkusModal(state);
                };
            } else {
                block.textContent = "空";
            }
            
            body.appendChild(block);
            container.appendChild(body);
            return container;
        };

        const updateInstructionBanner = (state) => {
            const banner = document.getElementById('instructionBanner');
            if (!banner) return;

            const inject = stateMgr.getEffectiveInjectPendingForCurrentUser(state);
            const wallError = stateMgr.getTransientWallError();
            const currentUserState = state.userStates?.[stateMgr.currentUserId] || {};
            const firestorePending = currentUserState.injectPending;
            const firestorePendingRequestId = firestorePending?.requestId || null;
            const firestorePendingCancelledLocally = stateMgr.isInjectRequestCancelled(firestorePendingRequestId);
            const remoteCancelled = currentUserState.injectPendingCancelled || null;
            const remoteCancelledMatches =
                !!firestorePending &&
                !!remoteCancelled &&
                !!remoteCancelled.requestId &&
                remoteCancelled.requestId === firestorePending.requestId;
            const pendingSuppressed = firestorePendingCancelledLocally || remoteCancelledMatches;
            const isWaitingUi =
                !pendingSuppressed &&
                inject &&
                inject.status === 'WAITING_SLOT';
            const isReady =
                !pendingSuppressed &&
                inject &&
                firestorePending &&
                firestorePending.status === 'WAITING_SLOT' &&
                inject.status === 'WAITING_SLOT';

            if (wallError?.message) {
                banner.className = 'instruction-banner inject-warning';
                banner.innerHTML = `<span>⚠️ ${wallError.message}</span>`;
                banner.classList.remove('hidden');
            } else if (isWaitingUi) {
                const uIdx = stateMgr.currentUserId.slice(-1);
                banner.className = `instruction-banner user-bg-${uIdx}`;
                banner.innerHTML = `
                    <div style="display:flex; justify-content:center; align-items:center; gap:1rem;">
                        <span>${isReady ? '📥' : '⏳'} <b>User ${uIdx}</b>: 商品 <b>${inject.jan}</b> ${isReady ? 'を投入する間口をタップしてください' : 'を同期中です。反映までお待ちください'}</span>
                        <button id="bannerCancelBtn" style="background:rgba(0,0,0,0.3); border:1px solid white; color:white; padding:4px 8px; border-radius:4px; font-size:0.8rem;">キャンセル</button>
                    </div>
                `;
                banner.classList.remove('hidden');
                document.getElementById('bannerCancelBtn').onclick = async () => {
                    try {
                        await stateMgr.cancelInjectPending();
                    } catch (e) {
                        console.error('banner cancel failed', e);
                    }
                };
            } else {
                banner.classList.add('hidden');
                banner.innerHTML = '';
            }
        };

        const render = (state) => {
            const renderStart = performance.now();
            countRender("wall");
            const config = getEffectiveWallConfig(state);
            const totalBays = getValidBaysOrBlock(state);
            if (totalBays === null) return;
            config.bays = totalBays;
            updateGlobalSettingsLoadWarning();
            const deviceSettings = getDeviceWallSettings();
            const displayScale = ['S', 'M', 'L'].includes(deviceSettings.displayScale) ? deviceSettings.displayScale : 'M';
            const denseTextMode = deviceSettings.denseTextMode !== false;
            const currentUserState = state?.userStates?.[stateMgr.currentUserId] || {};
            const activePickCount = Object.keys(currentUserState.activePick || {}).length;
            perf?.mark("wall.render.start", {
                mode: state?.mode || null,
                viewMode: config.viewMode || null,
                bays: totalBays,
                multiRows: config.multiRows || null,
                multiCols: config.multiCols || null,
                currentSingleBayId,
                slotsCount: Object.keys(state?.slots || {}).length,
                splitsCount: Object.keys(state?.splits || {}).length,
                activePickCount,
                optimisticSlotsCount: Object.keys(stateMgr.localUiState.optimisticSlots || {}).length,
                optimisticPickCompletionsCount: Object.keys(stateMgr.localUiState.optimisticPickCompletions || {}).length,
                scannerRunning: !!scannerRunning,
                displayScale,
                denseTextMode
            });
            try {
            if (!state) return;
            if (state.__isOfflineFallbackState) {
                showOfflineFallbackNotice();
                updateGlobalSettingsLoadWarning();
                if (!offlineFallbackSetupShown) {
                    showSetup(true);
                    offlineFallbackSetupShown = true;
                }
                wallHeader.classList.add('hidden');
                multiViewContainer.classList.add('hidden');
                selectorViewContainer.classList.add('hidden');
                singleViewContainer.classList.add('hidden');
                bay10Container.classList.add('hidden');
                homeBtn.classList.remove('hidden');
                return;
            }
            offlineFallbackSetupShown = false;
            hideOfflineFallbackNotice();
            updateInstructionBanner(state);
            const verifyConfig = getVerifyConfig(state);
            const getViewMaxSplit = () => {
                if (currentSingleBayId !== null) {
                    if (currentSingleBayId === 'unallocated') return 1;
                    return parseInt(state.splits?.[currentSingleBayId], 10) || 1;
                }
                if (config.viewMode === 'multi') {
                    const r = config.multiRows || 3;
                    const c = config.multiCols || 3;
                    const start = Math.max(1, parseInt(deviceSettings.multiStartId, 10) || 1);
                    const totalBays = config.bays;
                    const maxStart = Math.max(1, totalBays - (r * c) + 1);
                    const normalizedStart = Math.min(Math.max(1, start), maxStart);
                    const end = Math.min(config.bays, normalizedStart + (r * c) - 1);
                    let maxSplit = 1;
                    for (let bay = normalizedStart; bay <= end; bay++) {
                        maxSplit = Math.max(maxSplit, parseInt(state.splits?.[bay], 10) || 1);
                    }
                    return maxSplit;
                }
                let maxSplit = 1;
                for (let bay = 1; bay <= config.bays; bay++) {
                    maxSplit = Math.max(maxSplit, parseInt(state.splits?.[bay], 10) || 1);
                }
                return maxSplit;
            };
            const rootEl = document.querySelector('.wall-root');
            if (rootEl) {
                rootEl.dataset.displayScale = displayScale;
                const maxSplitInView = getViewMaxSplit();
                rootEl.dataset.dense = denseTextMode && maxSplitInView >= 5 ? 'true' : 'false';
            }
            document.body.dataset.displayScale = displayScale;

            if (verifyScannerControls) {
                const canUseScanner = verifyConfig.pickMode === 'VERIFY';
                verifyScannerControls.classList.toggle('hidden', !canUseScanner);
                if (canUseScanner) {
                    const supported = !!window.BarcodeDetector && !!navigator.mediaDevices?.getUserMedia;
                    if (scannerToggleBtn) scannerToggleBtn.disabled = !supported;
                    if (cameraFacingSelect) cameraFacingSelect.disabled = !supported;
                    if (!supported) {
                        setScannerStatus('この端末ではカメラ読取を利用できません');
                    }
                } else {
                    stopScanner();
                    if (scannerToggleBtn) scannerToggleBtn.disabled = false;
                    if (cameraFacingSelect) cameraFacingSelect.disabled = false;
                    setScannerResult('');
                }
            }

            if (!config.bays) {
                showSetup(false);
                wallHeader.classList.add('hidden');
                multiViewContainer.classList.add('hidden');
                selectorViewContainer.classList.add('hidden');
                singleViewContainer.classList.add('hidden');
                bay10Container.classList.add('hidden');
                homeBtn.classList.remove('hidden');
                return;
            }

            hideSetup();
            wallHeader.classList.remove('hidden');
            homeBtn.classList.add('hidden'); // hidden behind wall header to save space

            if (currentSingleBayId !== null) {
                // SHOW DETAIL
                const isUnallocated = currentSingleBayId === 'unallocated';
                if (openOthersBtn) {
                    if (isUnallocated) openOthersBtn.classList.add('hidden');
                    else openOthersBtn.classList.remove('hidden');
                }
                const nextBayNo = config.bays + 1;
                wallTitle.textContent = isUnallocated ? `No.${nextBayNo} その他` : `No.${currentSingleBayId} 詳細`;
                
                backBtn.classList.remove('hidden');
                multiViewContainer.classList.add('hidden');
                selectorViewContainer.classList.add('hidden');
                singleViewContainer.classList.remove('hidden');
                bay10Container.classList.add('hidden');

                singleViewContainer.innerHTML = '';
                if (isUnallocated) {
                    singleViewContainer.appendChild(renderUnallocatedDetail(state));
                } else {
                    singleViewContainer.appendChild(renderBayContent(currentSingleBayId, state, true));
                }
            } else if (config.viewMode === 'multi') {
                if (openOthersBtn) openOthersBtn.classList.remove('hidden');
                // Feature: MULTI VIEW
                wallTitle.textContent = "全間口一覧";
                backBtn.classList.add('hidden');
                multiViewContainer.classList.remove('hidden');
                selectorViewContainer.classList.add('hidden');
                singleViewContainer.classList.add('hidden');
                bay10Container.classList.add('hidden');

                const r = config.multiRows || 3;
                const c = config.multiCols || 3;
                const start = Math.max(1, parseInt(deviceSettings.multiStartId, 10) || 1);
                const totalBays = config.bays;
                const maxStart = Math.max(1, totalBays - (r * c) + 1);
                const normalizedStart = Math.min(Math.max(1, start), maxStart);
                const end = Math.min(config.bays, normalizedStart + (r * c) - 1);

                multiViewContainer.style.gridTemplateColumns = `repeat(${c}, 1fr)`;
                multiViewContainer.style.gridTemplateRows = `repeat(${r}, 1fr)`;
                multiViewContainer.innerHTML = '';

                for (let b = normalizedStart; b <= end; b++) {
                    multiViewContainer.appendChild(renderBayContent(b, state, false));
                }

            } else {
                if (openOthersBtn) openOthersBtn.classList.add('hidden');
                // Feature: SINGLE VIEW (Selector)
                wallTitle.textContent = "間口選択";
                backBtn.classList.add('hidden');
                multiViewContainer.classList.add('hidden');
                selectorViewContainer.classList.remove('hidden');
                singleViewContainer.classList.add('hidden');
                bay10Container.classList.add('hidden');
                
                selectorViewContainer.innerHTML = '';
                const duplicateHighlight = getActiveDuplicateHighlight(state);
                const duplicateHighlightBay = duplicateHighlight?.slotKey ? String(duplicateHighlight.slotKey).split('-')[0] : null;
                const isDuplicateFocusActive = !!duplicateHighlightBay;
                for (let b = 1; b <= config.bays; b++) {
                    const btn = document.createElement('div');
                    btn.className = 'selector-btn';
                    btn.style.position = 'relative';
                    const isDuplicateTargetBay = String(b) === duplicateHighlightBay;
                    if (isDuplicateFocusActive && !isDuplicateTargetBay) {
                        btn.style.opacity = '0.35';
                        btn.style.filter = 'grayscale(1)';
                    }
                    if (isDuplicateTargetBay) {
                        btn.classList.add('wall-duplicate-highlight');
                    }

                    // Check for any user indicators in any slot of this bay
                    let bayPickFound = false;
                    let bayDone = true;
                    const bayIndicators = [];
                    const splitCount = state.splits?.[b] || 1;
                    const activePicks = [];
                    for (let s = 1; s <= splitCount; s++) {
                        const slotInds = getIndicators(state, `${b}-${s}`);
                        slotInds.forEach(ind => {
                            if (!bayIndicators.find(i => i.uIdx === ind.uIdx)) bayIndicators.push(ind);
                            if (ind.type === 'PICK') {
                                bayPickFound = true;
                                if (ind.qty > 0) bayDone = false;
                            }
                        });
                    }

                    if (bayPickFound) {
                        btn.style.background = bayDone ? 'black' : '#eab308';
                        btn.style.color = bayDone ? '#eab308' : 'white';
                        btn.style.border = bayDone ? '2px solid #eab308' : '2px solid #fef08a';
                    }

                    btn.textContent = `No.${b}`;
                    if (bayIndicators.length > 0) {
                        const indContainer = document.createElement('div');
                        indContainer.className = 'indicator-container';
                        indContainer.style.top = '2px';
                        indContainer.style.right = '2px';
                        bayIndicators.forEach(ind => {
                            const dot = document.createElement('div');
                            dot.className = `user-dot user-dot-${ind.uIdx}`;
                            dot.style.width = '8px';
                            dot.style.height = '8px';
                            dot.style.fontSize = '0'; // skip text inside dot for selector
                            indContainer.appendChild(dot);
                        });
                        btn.appendChild(indContainer);
                    }

                    btn.onclick = () => {
                        currentSingleBayId = b;
                        render(stateMgr.state);
                    };
                    selectorViewContainer.appendChild(btn);
                }
                
                const nextBayNo = config.bays + 1;
                const unallocatedCount = collectUnallocatedItems(state).length;
                
                const othersIndicators = getIndicators(state, 'UNALLOCATED');
                const othersPickFound = othersIndicators.some(ind => ind.type === 'PICK');
                const othersDone = othersPickFound && othersIndicators.every(ind => ind.type !== 'PICK' || ind.qty === 0);

                const othersBtn = document.createElement('div');
                othersBtn.className = 'selector-btn';
                othersBtn.style.position = 'relative';
                if (isDuplicateFocusActive) {
                    othersBtn.style.opacity = '0.35';
                    othersBtn.style.filter = 'grayscale(1)';
                }

                if (othersPickFound) {
                    othersBtn.style.background = othersDone ? 'black' : '#eab308';
                    othersBtn.style.color = othersDone ? '#eab308' : 'white';
                    othersBtn.style.border = othersDone ? '2px solid #eab308' : '2px solid #fef08a';
                }
                othersBtn.style.gridColumn = '1 / -1';
                othersBtn.style.display = 'flex';
                othersBtn.style.flexDirection = 'row';
                othersBtn.style.justifyContent = 'space-between';
                othersBtn.style.alignItems = 'center';
                othersBtn.style.padding = '1.5rem';
                othersBtn.innerHTML = `
                    <div style="text-align: left; display:flex; flex-direction:column; align-items:flex-start;">
                        <span style="color: ${othersPickFound ? (othersDone ? '#ca8a04' : '#fefce8') : '#94a3b8'}; font-size: 0.8rem; font-weight: 800;">No.${nextBayNo}</span>
                        <span style="color: ${othersPickFound && othersDone ? '#eab308' : 'white'}; font-size: 1.2rem; font-weight: 800;">その他（未割り当て）</span>
                    </div>
                    <div style="display:flex; align-items:baseline; gap:0.5rem;">
                        ${othersPickFound ? `<span style="font-size: 0.9rem; font-weight: 800; background: ${othersDone ? 'transparent' : 'white'}; border: ${othersDone ? '2px solid #eab308' : 'none'}; color: ${othersDone ? '#eab308' : '#ca8a04'}; padding: 2px 6px; border-radius: 8px;">${othersDone ? '完了' : '対象'}</span>` : ''}
                        <span style="font-size: 1.8rem; font-weight: 900; color: ${othersPickFound ? (othersDone ? '#eab308' : 'white') : '#f59e0b'};">${unallocatedCount}</span>
                        <span style="color:${othersPickFound ? (othersDone ? '#ca8a04' : '#fefce8') : '#94a3b8'}; font-size:0.8rem; font-weight:700;">SKU</span>
                    </div>
                    <div class="indicator-container" style="top:4px; right:4px;">
                        ${othersIndicators.map(ind => `<div class="user-dot user-dot-${ind.uIdx}">${ind.uIdx}</div>`).join('')}
                    </div>
                `;
                othersBtn.onclick = () => {
                    currentSingleBayId = 'unallocated';
                    render(stateMgr.state);
                };
                selectorViewContainer.appendChild(othersBtn);
            }
            } finally {
                perf?.mark("wall.render.end", {
                    durationMs: Math.round(performance.now() - renderStart),
                    mode: state?.mode || null,
                    viewMode: getEffectiveWallConfig(state).viewMode || null,
                    bays: (state?.config || {}).bays || 0,
                    multiRows: getEffectiveWallConfig(state).multiRows || null,
                    multiCols: getEffectiveWallConfig(state).multiCols || null,
                    currentSingleBayId,
                    slotsCount: Object.keys(state?.slots || {}).length,
                    splitsCount: Object.keys(state?.splits || {}).length,
                    activePickCount: Object.keys((state?.userStates?.[stateMgr.currentUserId] || {}).activePick || {}).length,
                    optimisticSlotsCount: Object.keys(stateMgr.localUiState.optimisticSlots || {}).length,
                    optimisticPickCompletionsCount: Object.keys(stateMgr.localUiState.optimisticPickCompletions || {}).length,
                    scannerRunning: !!scannerRunning,
                    displayScale: ['S', 'M', 'L'].includes(getDeviceWallSettings().displayScale) ? getDeviceWallSettings().displayScale : 'M',
                    denseTextMode: getDeviceWallSettings().denseTextMode !== false
                });
            }
        };

        backBtn.addEventListener('click', () => {
            currentSingleBayId = null;
            render(stateMgr.state);
        });

        if (scannerToggleBtn) {
            scannerToggleBtn.addEventListener('click', async () => {
                if (scannerRunning) {
                    stopScanner();
                } else {
                    await startScanner();
                }
            });
        }

        if (cameraFacingSelect) {
            cameraFacingSelect.addEventListener('change', async () => {
                if (!scannerRunning) return;
                stopScanner();
                await startScanner();
            });
        }

        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.getAttribute('data-page');
                guardedNavigate(page);
            });
        });

        window.addEventListener('beforeunload', () => {
            stopScanner();
        });
    });
})();
