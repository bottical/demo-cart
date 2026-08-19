// Pick Mode Logic (Non-module)
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const listIdInput = document.getElementById('listIdInput');
        const pickTable = document.getElementById('pickTable');
        const currentListTitle = document.getElementById('currentListTitle');
        const sessionDisplay = document.getElementById('sessionDisplay');
        const pickProgressCard = document.getElementById('pickProgressCard');
        const pickProgressText = document.getElementById('pickProgressText');
        const pickProgressFill = document.getElementById('pickProgressFill');
        const pickModeToggle = document.getElementById('pickModeToggle');
        const quantityVerificationToggle = document.getElementById('quantityVerificationToggle');
        const janInputWrap = document.getElementById('janInputWrap');
        const janInput = document.getElementById('janInput');
        const janFeedback = document.getElementById('janFeedback');

        let lastRenderedPickingNo = null;
        let lastRenderedAllCompleted = false;
        const escapeHtml = (value) => String(value ?? '').replace(/[&<>\"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[ch]));

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
            (state) => render(state),
            (user) => {
                if (user) {
                    sessionDisplay.textContent = `USER: ${user.email}`;
                } else {
                    window.location.href = 'index.html';
                }
            }
        );

        const getConfig = (state = stateMgr.state) => {
            const cfg = state?.config || {};
            return {
                pickMode: cfg.pickMode === 'VERIFY' ? 'VERIFY' : 'NORMAL',
                quantityVerification: !!cfg.quantityVerification
            };
        };

        const getLineProgress = (line) => {
            const qty = Math.max(0, Number(line?.qty) || 0);
            const rawChecked = Number(line?.checkedQty);
            const checkedQty = Number.isFinite(rawChecked)
                ? Math.max(0, Math.min(qty, rawChecked))
                : (line?.status === 'DONE' ? qty : 0);
            return {
                qty,
                checkedQty,
                remainingQty: Math.max(0, qty - checkedQty),
                done: checkedQty >= qty
            };
        };

        const getStatusLabel = (line) => {
            const { qty, checkedQty, done } = getLineProgress(line);
            if (done) return '完了';
            if (checkedQty > 0 && checkedQty < qty) return 'PARTIAL';
            return '未着手';
        };

        const findNextConsumableLineIndex = (lines, jan) => {
            let hasSameJan = false;
            for (let idx = 0; idx < lines.length; idx += 1) {
                const line = lines[idx];
                if (String(line?.jan || '') !== String(jan)) continue;
                hasSameJan = true;
                if (!getLineProgress(line).done) return { index: idx, hasSameJan };
            }
            return { index: -1, hasSameJan };
        };

        const buildOptimisticConsumedLine = (line, quantityVerification) => {
            const { qty, checkedQty } = getLineProgress(line);
            const nextCheckedQty = quantityVerification ? Math.min(qty, checkedQty + 1) : qty;
            const nextStatus = nextCheckedQty >= qty ? 'DONE' : (nextCheckedQty > 0 ? 'PARTIAL' : 'PENDING');
            return {
                ...line,
                checkedQty: nextCheckedQty,
                status: nextStatus
            };
        };

        const canSafelyStealFocus = () => {
            if (document.hidden) return false;
            const active = document.activeElement;
            if (!active || active === document.body) return true;

            const tagName = String(active.tagName || '').toUpperCase();
            if (tagName === 'INPUT') {
                const type = String(active.type || '').toLowerCase();
                const passiveTypes = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file']);
                if (passiveTypes.has(type)) return false;
                return active === listIdInput || active === janInput;
            }
            if (tagName === 'BUTTON' || tagName === 'SELECT' || tagName === 'TEXTAREA') return false;
            return true;
        };

        const isFocusableInput = (el) => {
            if (!el) return false;
            if (el.disabled || el.readOnly) return false;
            if (el.type === 'hidden') return false;
            if (!el.offsetParent) return false;
            return true;
        };

        const restoreFocusIfNeeded = (state) => {
            const currentUserState = state?.userStates?.[stateMgr.currentUserId] || {};
            const currentPickingNo = currentUserState.currentPickingNo;
            const cfg = getConfig(state);
            const remoteLines = stateMgr.currentPickList?.lines || [];
            const lines = currentPickingNo ? stateMgr.getMergedPickLines(currentPickingNo, remoteLines) : [];
            const allCompleted = lines.length > 0 && lines.every((line) => getLineProgress(line).done);
            const verifyJanVisible = cfg.pickMode === 'VERIFY' && janInput && janInputWrap && !janInputWrap.classList.contains('hidden');
            const target = (!currentPickingNo || allCompleted || !verifyJanVisible) ? listIdInput : janInput;

            if (!isFocusableInput(target)) return;
            if (document.activeElement === target) return;
            if (!canSafelyStealFocus()) return;

            requestAnimationFrame(() => {
                if (!isFocusableInput(target)) return;
                if (document.activeElement === target) return;
                if (!canSafelyStealFocus()) return;
                target.focus();
            });
        };

        const focusForCurrentMode = (state) => {
            restoreFocusIfNeeded(state);
        };

        const showJanFeedback = (message, type = 'info') => {
            if (!janFeedback) return;
            janFeedback.textContent = message || '';
            janFeedback.className = `pick-feedback ${type}`;
        };

        const updateModeUI = (state) => {
            const cfg = getConfig(state);
            if (pickModeToggle) pickModeToggle.checked = cfg.pickMode === 'VERIFY';
            if (quantityVerificationToggle) quantityVerificationToggle.checked = cfg.quantityVerification;
            if (quantityVerificationToggle) quantityVerificationToggle.disabled = cfg.pickMode !== 'VERIFY';
            if (janInputWrap) janInputWrap.classList.toggle('hidden', cfg.pickMode !== 'VERIFY');
            if (quantityVerificationToggle) quantityVerificationToggle.style.opacity = cfg.pickMode === 'VERIFY' ? '1' : '0.6';
            if (cfg.pickMode !== 'VERIFY') {
                showJanFeedback('');
            }
        };

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

        const showInlineError = (message) => {
            currentListTitle.innerHTML = `<span style="color: var(--danger);">${message}</span>`;
        };
        const navGuard = window.NavigationGuard.createNavigationHelpers({
            stateMgr,
            audioManager: AudioManager,
            onCancelError: () => {
                showInlineError('作業のキャンセルに失敗したため、ページ移動を中止しました。通信状態をご確認ください。');
            }
        });
        const guardedNavigate = navGuard.guardedNavigate;
        const navigateWithCompletedPickCleanup = async (page) => {
            const currentUserState = stateMgr.state?.userStates?.[stateMgr.currentUserId] || {};
            const currentPickingNo = currentUserState.currentPickingNo;
            if (page === 'inject.html' && currentPickingNo && stateMgr.currentPickListLoading) {
                showInlineError('ピッキング状態を確認中です。少し待ってから再度お試しください。');
                AudioManager?.playErrorSound?.();
                return;
            }
            const remoteLines = stateMgr.currentPickList?.lines || [];
            const lines = currentPickingNo
                ? stateMgr.getMergedPickLines(currentPickingNo, remoteLines)
                : [];
            const allCompleted = lines.length > 0 && lines.every((line) => getLineProgress(line).done);

            if (page === 'inject.html' && currentPickingNo && allCompleted) {
                try {
                    await stateMgr.resetUserPick(stateMgr.currentUserId);
                    window.location.href = page;
                    return;
                } catch (e) {
                    console.error('完了済みピッキングの解除に失敗しました:', e);
                    AudioManager?.playErrorSound?.();
                    showInlineError('完了済みピッキングの解除に失敗したため、ページ移動を中止しました。通信状態をご確認ください。');
                    return;
                }
            }

            await guardedNavigate(page);
        };

        const loadListCore = async (id) => {
            const pickList = await stateMgr.loadPickList(id);
            if (!pickList) {
                AudioManager.playErrorSound();
                listIdInput.value = '';
                currentListTitle.innerHTML = `<span style="color: var(--danger);">エラー：見つかりません (${id})</span>`;
                pickTable.innerHTML = `<tr><td colspan="5" style="padding:3rem; text-align:center; color:var(--danger); font-size:1.2rem; font-weight:bold;">入力されたピッキングNo.「${id}」が存在しません。</td></tr>`;
                return;
            }
            listIdInput.value = '';
            const lines = pickList?.lines || [];
            const janIndex = stateMgr.state?.janIndex || {};
            const newActivePick = stateMgr._buildActivePickFromLines(id, lines, janIndex);
            const allCompleted = lines.length > 0 && lines.every((l) => getLineProgress(l).done);
            if (allCompleted) AudioManager.playErrorSound();
            else AudioManager.playStartSound();
            await stateMgr.startPicking(id, newActivePick);
            focusForCurrentMode(stateMgr.state);
        };

        const loadList = async (id) => {
            const targetId = (id || '').trim();
            if (!targetId) return;
            const work = stateMgr.getInProgressWorkForCurrentUser(stateMgr.state);
            const currentPickingNo = work.currentPickingNo || null;
            if (!work.hasInjectInProgress && !work.hasPickInProgress) {
                await loadListCore(targetId);
                return;
            }
            if (currentPickingNo && String(currentPickingNo) === String(targetId)) {
                return;
            }

            const message = window.NavigationGuard.buildSwitchPickingMessage(currentPickingNo || '---', targetId, work);
            const proceed = await navGuard.showNavigationConfirmModal(message);
            if (!proceed) return;

            try {
                await stateMgr.cancelCurrentWorkForNavigation();
                await loadListCore(targetId);
            } catch (e) {
                console.error('ピッキング切り替え時のキャンセルに失敗しました:', e);
                AudioManager?.playErrorSound?.();
                showInlineError('ピッキング作業のキャンセルに失敗したため、新規読込を中止しました。通信状態をご確認ください。');
            }
        };

        const consumeByJan = async (inputJan) => {
            const janOpStart = performance.now();
            const jan = stateMgr.normalizeJanValue(inputJan);
            if (!jan) return;
            const currentUserState = stateMgr.state?.userStates?.[stateMgr.currentUserId] || {};
            const currentPickingNo = currentUserState.currentPickingNo;
            if (!currentPickingNo) {
                showJanFeedback('先にピッキングNo.を読込してください', 'error');
                AudioManager.playErrorSound();
                return;
            }
            const cfg = getConfig();
            const quantityVerification = !!cfg.quantityVerification;
            perf?.mark('pick.verify.jan.start', { currentPickingNo, lineIndex: null, janLast4: jan.slice(-4), quantityVerification, elapsedMs: 0 });
            const remoteLines = stateMgr.currentPickList?.lines || [];
            const mergedLines = stateMgr.getMergedPickLines(currentPickingNo, remoteLines);
            const matched = findNextConsumableLineIndex(mergedLines, jan);
            if (matched.index < 0) {
                AudioManager.playErrorSound();
                showJanFeedback(matched.hasSameJan ? '既に完了済みです' : 'このピッキングNo.の対象外です', 'error');
                if (janInput) {
                    janInput.value = '';
                    focusForCurrentMode(stateMgr.state);
                }
                return;
            }

            const nextLine = buildOptimisticConsumedLine(mergedLines[matched.index], cfg.quantityVerification);
            const opId = stateMgr.setOptimisticPickLine(currentPickingNo, matched.index, nextLine);
            perf?.mark('pick.verify.jan.optimistic.set', { currentPickingNo, lineIndex: matched.index, janLast4: jan.slice(-4), quantityVerification, elapsedMs: Math.round(performance.now() - janOpStart) });
            AudioManager.playStartSound();
            
            if (nextLine.status === 'DONE') {
                showJanFeedback(`...${jan.slice(-4)} 完了`, 'success');
            } else {
                const checkedQty = Math.max(0, Number(nextLine.checkedQty) || 0);
                const qty = Math.max(0, Number(nextLine.qty) || 0);
                showJanFeedback(`...${jan.slice(-4)} OK (${checkedQty}/${qty})`, 'success');
            }

            if (janInput) {
                janInput.value = '';
                focusForCurrentMode(stateMgr.state);
            }

            stateMgr.consumePickByJan(currentPickingNo, jan).then((result) => {
                if (result?.result === 'done' || result?.result === 'partial') {
                    const serverIndex = Number.isInteger(result?.index) ? result.index : matched.index;
                    const serverLine = result?.line || nextLine;
                    const optimisticProgress = getLineProgress(nextLine);
                    const serverProgress = getLineProgress(serverLine);
                    const optimisticStatus = nextLine?.status || (optimisticProgress.done ? 'DONE' : 'PARTIAL');
                    const serverStatus = serverLine?.status || (serverProgress.done ? 'DONE' : (serverProgress.checkedQty > 0 ? 'PARTIAL' : 'PENDING'));
                    const hasServerMismatch = optimisticProgress.checkedQty !== serverProgress.checkedQty || optimisticStatus !== serverStatus;

                    if (hasServerMismatch) {
                        stateMgr.clearOptimisticPickLine(currentPickingNo, matched.index, opId);
                        const serverOpId = stateMgr.setOptimisticPickLine(currentPickingNo, serverIndex, serverLine);
                        stateMgr.markOptimisticPickLineCommitted(currentPickingNo, serverIndex, serverOpId);
                    } else {
                        stateMgr.markOptimisticPickLineCommitted(currentPickingNo, matched.index, opId);
                    }

                    return;
                }
                stateMgr.clearOptimisticPickLine(currentPickingNo, matched.index, opId);
                AudioManager.playErrorSound();
                showJanFeedback(result?.result === 'already_done' ? '既に完了済みです' : 'このピッキングNo.の対象外です', 'error');
                perf?.mark('pick.verify.jan.failed', { currentPickingNo, lineIndex: matched.index, janLast4: jan.slice(-4), quantityVerification, elapsedMs: Math.round(performance.now() - janOpStart), result: result?.result || 'not_found' });
            }).catch((e) => {
                console.error('consumeByJan failed:', e);
                stateMgr.clearOptimisticPickLine(currentPickingNo, matched.index, opId);
                AudioManager.playErrorSound();
                showJanFeedback('JAN処理に失敗しました', 'error');
                perf?.mark('pick.verify.jan.failed', { currentPickingNo, lineIndex: matched.index, janLast4: jan.slice(-4), quantityVerification, elapsedMs: Math.round(performance.now() - janOpStart), message: e?.message || String(e) });
                render(stateMgr.state || {});
            });
        };

        navGuard.installBeforeUnloadGuard();

        const updateProgressUi = (summary) => {
            const progressSummary = summary || { total: 0, completed: 0 };
            const total = Number(progressSummary?.total) || 0;
            const completed = Number(progressSummary?.completed) || 0;
            if (!pickProgressCard || !pickProgressText || !pickProgressFill) return;

            pickProgressText.textContent = `${completed} / ${total}`;
            pickProgressFill.style.width = `${total > 0 ? (completed / total) * 100 : 0}%`;
            pickProgressCard.classList.toggle('hidden', total === 0);
        };

        const render = (state) => {
            const renderStart = performance.now();
            countRender("pick");
            const cfg = getConfig(state);
            const currentUserState = state?.userStates?.[stateMgr.currentUserId] || {};
            const currentPickingNo = currentUserState.currentPickingNo || null;
            const currentPickLines = stateMgr.currentPickList?.lines || null;
            perf?.mark("pick.render.start", {
                currentPickingNo,
                currentPickListId: stateMgr.currentPickListId || null,
                currentPickListLoading: !!stateMgr.currentPickListLoading,
                currentPickLinesCount: Array.isArray(currentPickLines) ? currentPickLines.length : 0,
                optimisticPickLineOpsCount: Object.keys(stateMgr.localUiState.optimisticPickLineOps?.[String(currentPickingNo || '')] || {}).length,
                pickMode: cfg.pickMode,
                quantityVerification: cfg.quantityVerification
            });
            try {
            const progressSummary = state?.progressSummary || { total: 0, completed: 0 };
            updateProgressUi(progressSummary);
            updateUserSelectorUI();
            updateModeUI(state);
            pickTable.innerHTML = '';
            if (!currentPickingNo) {
                lastRenderedPickingNo = currentPickingNo || null;
                lastRenderedAllCompleted = false;
                const msg = 'ピッキングNo.を入力してください';
                pickTable.innerHTML = `<tr><td colspan="5" style="padding:3rem; text-align:center; color:var(--text-muted);">${msg}</td></tr>`;
                currentListTitle.textContent = 'ピッキングNo.を入力してください';
                restoreFocusIfNeeded(state);
                return;
            }
            const isPickListSwitching =
                !!currentPickingNo &&
                (
                    stateMgr.currentPickListLoading ||
                    !stateMgr.currentPickListId ||
                    String(stateMgr.currentPickListId) !== String(currentPickingNo)
                );
            if (isPickListSwitching) {
                pickTable.innerHTML = `<tr><td colspan="5" style="padding:3rem; text-align:center; color:var(--text-muted);">ピッキングリストを同期しています...</td></tr>`;
                currentListTitle.textContent = `ピッキングNo. ${currentPickingNo} を同期中...`;
                restoreFocusIfNeeded(state);
                return;
            }
            if (!currentPickLines) {
                const msg = stateMgr.currentPickListNotFound ? 'データが見つかりません' : '読込中...';
                pickTable.innerHTML = `<tr><td colspan="5" style="padding:3rem; text-align:center; color:var(--text-muted);">${msg}</td></tr>`;
                currentListTitle.textContent = `ピッキングNo. ${currentPickingNo}`;
                restoreFocusIfNeeded(state);
                return;
            }

            const lines = stateMgr.getMergedPickLines(currentPickingNo, currentPickLines || []);
            const optimisticLineOps = stateMgr.localUiState.optimisticPickLineOps?.[String(currentPickingNo)] || {};
            const allCompleted = lines.length > 0 && lines.every((l) => getLineProgress(l).done);
            if (
                lastRenderedPickingNo === currentPickingNo &&
                lastRenderedAllCompleted === false &&
                allCompleted === true
            ) {
                AudioManager.playCompleteSound();
                restoreFocusIfNeeded(state);
            }
            if (allCompleted) {
                currentListTitle.innerHTML = `<span style="color: red;">完了済み：${currentPickingNo}</span>`;
            } else {
                currentListTitle.innerHTML = `<span class="user-text-${stateMgr.currentUserId.slice(-1)}">【ユーザー${stateMgr.currentUserId.slice(-1)}】</span> ピッキング中: ${currentPickingNo}`;
            }
            lastRenderedPickingNo = currentPickingNo;
            lastRenderedAllCompleted = allCompleted;
            lines.forEach((line, idx) => {
                const location = state.janIndex?.[line.jan] || 'その他';
                const subId = location.includes('-') ? location.split('-')[1] : null;
                const { qty, checkedQty, done } = getLineProgress(line);
                const statusLabel = getStatusLabel(line);
                const productLabel = String(line.productLabel || state.productInfo?.[line.jan]?.productLabel || '').replace(/^[\s　]+|[\s　]+$/g, '');

                const tr = document.createElement('tr');
                const isOptimistic = !!optimisticLineOps[String(idx)];
                tr.classList.toggle('pick-row-optimistic', isOptimistic);
                tr.style.opacity = done ? 0.5 : 1;
                if (done) tr.style.background = '#f8fafc';

                tr.innerHTML = `
                    <td style="padding:1rem; font-weight:600;">
                        ${productLabel ? `<div style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(productLabel)}</div>` : ''}
                        <div style="font-family:monospace; ${productLabel ? 'font-size:0.85rem; color:#64748b;' : ''}">...${line.jan.slice(-4)}</div>
                    </td>
                    <td style="padding:1rem; font-size:1.25rem; font-weight:800;">${cfg.pickMode === 'VERIFY' ? `${checkedQty} / ${qty}` : qty}</td>
                    <td style="padding:1rem;">
                        <span style="padding:0.25rem 0.75rem; border-radius:4px; font-weight:800; font-size:1.5rem; color:white; background:${subId ? `hsl(${(subId - 1) * 60 + 200}, 70%, 50%)` : '#eab308'}">
                            ${location}
                        </span>
                    </td>
                    <td style="padding:1rem;">
                        <span class="status-badge ${done ? 'status-done' : (statusLabel === 'PARTIAL' ? 'status-partial' : 'status-pending')}">
                            ${statusLabel}${isOptimistic ? ' ・処理中' : ''}
                        </span>
                    </td>
                    <td style="padding:1rem;">
                        ${!done
                        ? `<button class="btn btn-primary btn-sm complete-btn user-bg-${stateMgr.currentUserId.slice(-1)}" data-index="${idx}">完了</button>`
                        : '✅'}
                    </td>
                `;
                pickTable.appendChild(tr);
            });

            document.querySelectorAll('.complete-btn').forEach((btn) => {
                btn.onclick = () => {
                    const idx = btn.getAttribute('data-index');
                    completeLine(idx);
                };
            });

            restoreFocusIfNeeded(state);
            } finally {
                perf?.mark("pick.render.end", {
                    durationMs: Math.round(performance.now() - renderStart),
                    currentPickingNo,
                    currentPickListId: stateMgr.currentPickListId || null,
                    currentPickListLoading: !!stateMgr.currentPickListLoading,
                    currentPickLinesCount: Array.isArray(stateMgr.currentPickList?.lines) ? stateMgr.currentPickList.lines.length : 0,
                    optimisticPickLineOpsCount: Object.keys(stateMgr.localUiState.optimisticPickLineOps?.[String(currentPickingNo || '')] || {}).length,
                    pickMode: cfg.pickMode,
                    quantityVerification: cfg.quantityVerification
                });
            }
        };

        const completeLine = async (index) => {
            const opStart = performance.now();
            const currentUserState = stateMgr.state.userStates?.[stateMgr.currentUserId];
            const currentPickingNo = currentUserState?.currentPickingNo;
            if (!currentPickingNo) return;
            const lineIndex = Number(index);
            const line = stateMgr.getMergedPickLines(currentPickingNo, stateMgr.currentPickList?.lines || [])[lineIndex] || {};
            const janLast4 = String(line?.jan || '').slice(-4);
            const quantityVerification = !!getConfig().quantityVerification;
            perf?.mark('pick.complete.button.start', { currentPickingNo, lineIndex, janLast4, quantityVerification, elapsedMs: 0 });

            try {
                await stateMgr.completePickLine(currentPickingNo, lineIndex);
                perf?.mark('pick.complete.button.success', { currentPickingNo, lineIndex, janLast4, quantityVerification, elapsedMs: Math.round(performance.now() - opStart) });
            } catch (e) {
                console.error('completeLine failed:', e);
                AudioManager?.playErrorSound?.();
                showInlineError('完了処理に失敗しました。通信状態をご確認ください。');
                perf?.mark('pick.complete.button.failed', { currentPickingNo, lineIndex, janLast4, quantityVerification, elapsedMs: Math.round(performance.now() - opStart), message: e?.message || String(e) });
            }
        };

        // UI Event Listeners
        listIdInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') loadList(listIdInput.value.trim());
        });

        if (janInput) {
            janInput.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const cfg = getConfig();
                if (cfg.pickMode !== 'VERIFY') return;
                consumeByJan(janInput.value);
            });
        }

        if (pickModeToggle) {
            pickModeToggle.addEventListener('change', async () => {
                const nextPickMode = pickModeToggle.checked ? 'VERIFY' : 'NORMAL';
                try {
                    await stateMgr.update({
                        'config.pickMode': nextPickMode
                    });
                    if (nextPickMode === 'VERIFY') {
                        showJanFeedback('検品モードON', 'info');
                    }
                    restoreFocusIfNeeded(stateMgr.state);
                } catch (e) {
                    console.error('pickMode update failed:', e);
                }
            });
        }

        if (quantityVerificationToggle) {
            quantityVerificationToggle.addEventListener('change', async () => {
                try {
                    await stateMgr.update({
                        'config.quantityVerification': !!quantityVerificationToggle.checked
                    });
                } catch (e) {
                    console.error('quantityVerification update failed:', e);
                }
            });
        }

        document.getElementById('resetPickingBtn').onclick = async () => {
            const currentUserState = stateMgr.state.userStates?.[stateMgr.currentUserId];
            if (!currentUserState?.currentPickingNo) return;

            try {
                await stateMgr.resetUserPick(stateMgr.currentUserId);
                alert('ピッキング作業をリセットしました（未完了は初期化、完了済みは完了状態のまま解除）');
            } catch (e) {
                console.error('resetPicking failed:', e);
                AudioManager?.playErrorSound?.();
                showInlineError('リセットに失敗しました。通信状態をご確認ください。');
            }
        };

        const userSelect = document.getElementById('userSelect');
        if (userSelect) {
            userSelect.addEventListener('change', (e) => {
                stateMgr.setCurrentUser(e.target.value);
                requestAnimationFrame(() => restoreFocusIfNeeded(stateMgr.state));
            });
        }

        window.addEventListener('focus', () => {
            restoreFocusIfNeeded(stateMgr.state);
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) restoreFocusIfNeeded(stateMgr.state);
        });

        document.querySelectorAll('.nav-link').forEach((link) => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.getAttribute('data-page');
                if (page === 'inject.html') {
                    navigateWithCompletedPickCleanup(page);
                    return;
                }
                guardedNavigate(page);
            });
        });

        listIdInput.focus();
    });
})();
