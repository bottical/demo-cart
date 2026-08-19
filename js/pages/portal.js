// Portal Page Logic (Non-module)
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const loginSection = document.getElementById('loginSection');
        const menuSection = document.getElementById('menuSection');
        const userEmail = document.getElementById('userEmail');
        const emailInput = document.getElementById('emailInput');
        const passInput = document.getElementById('passInput');

        const pickListSourceCard = document.getElementById('pickListSourceCard');
        const pickListSourceName = document.getElementById('pickListSourceName');
        const pickListSourceMeta = document.getElementById('pickListSourceMeta');
        const resetBtn = document.getElementById('resetBtn');
        let isStateReady = false;
        const updateResetButtonState = () => {
            if (!resetBtn) return;
            resetBtn.disabled = !isStateReady;
            resetBtn.title = isStateReady
                ? ''
                : '状態を読み込み中です。少し待ってから操作してください。';
            resetBtn.style.opacity = isStateReady ? '1' : '0.45';
            resetBtn.style.cursor = isStateReady ? 'pointer' : 'not-allowed';
        };

        const updatePickListSourceUi = (state) => {
            if (!pickListSourceCard || !pickListSourceName || !pickListSourceMeta) return;

            const source = state?.pickListSource || null;
            const injectListCount = Object.keys(state?.injectList || {}).length;
            const progressTotal = Number(state?.progressSummary?.total) || 0;
            const hasPickList = injectListCount > 0 || progressTotal > 0;

            pickListSourceCard.classList.remove('hidden');

            if (!hasPickList || !source?.fileName) {
                pickListSourceName.textContent = 'ピッキングリスト未読込';
                pickListSourceMeta.textContent = '';
                return;
            }

            pickListSourceName.textContent = source.fileName;
            const importedAt = source.importedAt
                ? new Date(source.importedAt).toLocaleString('ja-JP')
                : '';
            pickListSourceMeta.textContent = importedAt
                ? `読込日時: ${importedAt}`
                : '';
        };

        const stateMgr = new StateManager(
            (state) => {
                isStateReady = !!(state && state.config);
                updateResetButtonState();
                updatePickListSourceUi(state);
            },
            (user) => {
                document.getElementById('loader')?.classList.add('hidden');
                document.getElementById('appContent')?.classList.remove('hidden');

                if (user) {
                    loginSection.classList.add('hidden');
                    menuSection.classList.remove('hidden');
                    userEmail.textContent = user.email;
                    isStateReady = false;
                    updateResetButtonState();
                } else {
                    loginSection.classList.remove('hidden');
                    menuSection.classList.add('hidden');
                    isStateReady = false;
                    updateResetButtonState();
                    updatePickListSourceUi(null);
                }
            }
        );

        window.handleAuth = async (action) => {
            const email = emailInput.value;
            const pass = passInput.value;
            try {
                if (action === 'LOGIN') await stateMgr.login(email, pass);
                if (action === 'SIGNUP') await stateMgr.signup(email, pass);
                if (action === 'LOGOUT') await stateMgr.logout();
            } catch (e) {
                alert("認証エラー: " + e.message);
            }
        };

        const openPage = (page) => {
            window.location.href = page;
        };

        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const page = item.getAttribute('data-page');
                openPage(page);
            });
        });

        updateResetButtonState();

        resetBtn?.addEventListener('click', async () => {
            if (!isStateReady || !stateMgr.state || !stateMgr.state.config) {
                alert("状態を読み込み中です。少し待ってから再度リセットしてください。");
                return;
            }

            if (!confirm("全ての投入データ・配置・ピッキングリストを初期化します。バックアップ作成後に実行します。続行しますか？")) {
                return;
            }
            const confirmationText = prompt('最終確認です。リセットする場合は RESET と入力してください。');
            if (confirmationText !== 'RESET') {
                alert('確認文字列が一致しないためリセットを中止しました。');
                return;
            }
            const operationId = `reset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            try {
                await stateMgr.resetPreserveConfig({ operationId, confirmationText });
                alert("リセット完了");
            } catch (e) {
                alert("エラー: " + e.message);
            }
        });
    });
})();
