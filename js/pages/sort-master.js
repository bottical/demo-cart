(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const mgr = new SortStateManager(() => {}, (u) => { if (!u) location.href = 'index.html'; else refresh(); });
    let entries = []; let editing = null; let pendingImport = []; let configuredMaxSlotNo = 0;
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const no = (n) => `No.${String(n).padStart(3, '0')}`;
    const timeText = (v) => { const d = v?.toDate ? v.toDate() : v ? new Date(v) : null; return d && !Number.isNaN(d.valueOf()) ? d.toLocaleString('ja-JP') : '－'; };
    const timeMillis = (v) => v?.toMillis ? v.toMillis() : v?.toDate ? v.toDate().getTime() : v ? new Date(v).getTime() : 0;
    const message = (s, bad=false) => { $('message').textContent=s; $('message').style.color=bad?'var(--danger)':'var(--success)'; };
    const entryMessage = (s='') => { $('entryError').textContent=s; };
    async function refresh() {
      entries = await mgr.getDestinationMaster();
      const config = await mgr.getDestinationConfig();
      configuredMaxSlotNo = Number(config.maxSlotNo) || 0;
      $('maxSlotNo').value = configuredMaxSlotNo || Math.max(1, ...entries.map(v=>Number(v.slotNo)));
      const active = await mgr.getActiveBatch(); $('activeNotice').hidden = !active;
      const last = entries.reduce((a,v) => !a || timeMillis(v.updatedAt) > timeMillis(a.updatedAt) ? v:a, null);
      $('summary').textContent = `登録：${entries.length}件　有効：${entries.filter(v=>v.enabled).length}件　最終更新：${last ? timeText(last.updatedAt) : '－'}`;
      render();
    }
    function render() {
      const q = $('search').value.trim().toLowerCase();
      const max = Math.max(configuredMaxSlotNo, ...entries.map(v=>Number(v.slotNo)));
      const bySlot = Object.fromEntries(entries.map(v=>[v.slotNo,v]));
      $('slotGrid').innerHTML = Array.from({length:max},(_,i)=>bySlot[i+1] ? `<button class="sort-master-slot ${bySlot[i+1].enabled?'':'is-disabled'}" data-code="${esc(bySlot[i+1].destinationCode)}"><b>${no(i+1)}</b><strong>${esc(bySlot[i+1].destinationName)}</strong><span>${esc(bySlot[i+1].destinationCode)}</span></button>` : `<div class="sort-master-slot is-vacant"><b>${no(i+1)}</b><strong>空き</strong></div>`).join('') || '<p>未登録です</p>';
      $('masterRows').innerHTML = entries.filter(v=>!q || `${v.destinationCode} ${v.destinationName}`.toLowerCase().includes(q)).map(v=>`<tr><td>${String(v.slotNo).padStart(3,'0')}</td><td>${esc(v.destinationCode)}</td><td>${esc(v.destinationName)}</td><td>${v.enabled?'有効':'無効'}</td><td><button class="btn btn-outline edit-entry" data-code="${esc(v.destinationCode)}">編集</button> ${v.enabled?`<button class="btn btn-outline disable-entry" data-code="${esc(v.destinationCode)}">無効化</button>`:''} <button class="btn btn-danger delete-entry" data-code="${esc(v.destinationCode)}">削除</button></td></tr>`).join('');
    }
    function openEntry(entry=null) { editing=entry; entryMessage(); $('dialogTitle').textContent=entry?'編集':'新規登録'; $('entryCode').value=entry?.destinationCode||''; $('entryCode').disabled=!!entry; $('entryName').value=entry?.destinationName||''; $('entrySlot').value=entry?.slotNo||''; $('entryEnabled').checked=entry?.enabled!==false; $('entryDialog').showModal(); }
    $('newBtn').onclick=()=>openEntry(); $('search').oninput=render;
    $('saveMaxSlotNo').onclick=async()=>{ const maxSlotNo=Number($('maxSlotNo').value); const configMessage=$('configMessage'); configMessage.textContent=''; if(!Number.isInteger(maxSlotNo)||maxSlotNo<1){configMessage.textContent='物理配置数は1以上の整数で入力してください';configMessage.style.color='var(--danger)';return;} try{await mgr.saveDestinationConfig(maxSlotNo);configuredMaxSlotNo=maxSlotNo;configMessage.textContent='物理配置数を保存しました';configMessage.style.color='var(--success)';render();}catch(err){configMessage.textContent=err.message;configMessage.style.color='var(--danger)';} };
    const resetEntry = () => { editing = null; entryMessage(''); };
    $('cancelEntry').onclick = () => { $('entryDialog').close(); resetEntry(); };
    $('entryDialog').addEventListener('close', resetEntry);
    document.addEventListener('click', async(e)=>{ const editTarget=e.target.closest('.sort-master-slot,.edit-entry'); const code=(editTarget||e.target).dataset?.code; if(editTarget) { const x=entries.find(v=>v.destinationCode===code); if(x) openEntry(x); } if(e.target.classList.contains('disable-entry')) { const x=entries.find(v=>v.destinationCode===code); if(confirm(`${x.destinationName}（${code}）を無効にします。\n\n過去バッチには影響しません。\n今後の新規バッチでは使用できなくなります。`)) { await mgr.disableDestinationMasterEntry(code); await refresh(); } } if(e.target.classList.contains('delete-entry')) { const x=entries.find(v=>v.destinationCode===code); if(x&&confirm(`${x.destinationName}（${code}）を仕分け先マスターから削除します。\n\n配置No.${String(x.slotNo).padStart(3,'0')}は空きになります。\n\n現在進行中および過去の仕分けバッチには影響しません。\n次回のバッチ作成からマスター未登録扱いになります。\n\nこの操作を実行しますか？`)) { await mgr.deleteDestinationMasterEntry(code); message('仕分け先マスターから削除しました'); await refresh(); } } });
    $('saveEntry').onclick=async(e)=>{ e.preventDefault(); entryMessage(); const value={destinationCode:$('entryCode').value.trim(),destinationName:$('entryName').value.trim(),slotNo:Number($('entrySlot').value),enabled:$('entryEnabled').checked}; if(!value.destinationCode||!value.destinationName||!Number.isInteger(value.slotNo)||value.slotNo<1){entryMessage('必須項目と配置No.を確認してください');return;} if(!editing&&entries.some(v=>v.destinationCode===value.destinationCode)){entryMessage('仕分け先コードが重複しています');return;} const occupant=entries.find(v=>v.destinationCode!==value.destinationCode&&Number(v.slotNo)===value.slotNo); let swap=false; if(occupant){ if(!editing){entryMessage(`${no(value.slotNo)}は「${occupant.destinationName}」が使用しています`);return;} swap=confirm(`${no(value.slotNo)}には「${occupant.destinationName}」が設定されています。\n\n${editing.destinationName} ${no(editing.slotNo)}\n${occupant.destinationName} ${no(occupant.slotNo)}\n\n配置を入れ替えますか？`); if(!swap)return;} try{await mgr.saveDestinationMasterEntry(value,{swap});$('entryDialog').close();message('保存しました');await refresh();}catch(err){entryMessage(err.message);} };
    const parseCsv=(s)=>{const out=[];let row=[],cell='',quote=false;for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(quote&&s[i+1]==='"'){cell+='"';i++;}else quote=!quote;}else if(c===','&&!quote){row.push(cell);cell='';}else if(/[\r\n]/.test(c)&&!quote){if(c==='\r'&&s[i+1]==='\n')i++;row.push(cell);out.push(row);row=[];cell='';}else cell+=c;}if(row.length||cell){row.push(cell);out.push(row);}return out;};
    const readCsvRows = async (file) => {
      const buf = await file.arrayBuffer();
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
      catch (_) { text = new TextDecoder('shift_jis', { fatal: false }).decode(buf); }
      return parseCsv(text.replace(/^\uFEFF/, ''));
    };
    const parseEnabled = (raw, rowNo) => {
      const value = String(raw).trim().toLowerCase();
      if (['true', '1', '有効'].includes(value)) return true;
      if (['false', '0', '無効'].includes(value)) return false;
      throw new Error(`${rowNo}行目: 有効は true / false / 1 / 0 / 有効 / 無効 のいずれかで指定してください`);
    };
    const validateImportDuplicates = (values) => {
      const codes = new Map(); const slots = new Map();
      values.forEach((v) => {
        if (codes.has(v.destinationCode)) throw new Error(`仕分け先コード ${v.destinationCode} が複数行に存在します（${codes.get(v.destinationCode)}行目、${v.rowNo}行目）`);
        codes.set(v.destinationCode, v.rowNo);
        const prior = slots.get(v.slotNo);
        if (prior) throw new Error(`配置No.${String(v.slotNo).padStart(3, '0')} が重複しています。\n${prior.destinationCode} ${prior.destinationName}\n${v.destinationCode} ${v.destinationName}`);
        slots.set(v.slotNo, v);
      });
    };
    $('masterFile').onchange=async()=>{try{const f=$('masterFile').files[0];let rows;if(/\.xlsx?$/.test(f.name.toLowerCase())){const wb=XLSX.read(await f.arrayBuffer(),{type:'array'});rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''});}else rows=await readCsvRows(f); const h=(rows[0]||[]).map(v=>String(v).trim()); const required=['仕分け先コード','仕分け先名','配置No','有効']; const absent=required.filter(x=>!h.includes(x)); if(absent.length)throw new Error(`必須ヘッダーがありません: ${absent.join('、')}`); const idx=(x)=>h.indexOf(x); pendingImport=rows.slice(1).map((r,i)=>({row:r,rowNo:i+2})).filter(x=>x.row.some(v=>String(v).trim())).map(({row:r,rowNo})=>({destinationCode:String(r[idx('仕分け先コード')]||'').trim(),destinationName:String(r[idx('仕分け先名')]||'').trim(),slotNo:Number(r[idx('配置No')]),enabled:parseEnabled(r[idx('有効')],rowNo),rowNo})); if(pendingImport.some(v=>!v.destinationCode||!v.destinationName||!Number.isInteger(v.slotNo)||v.slotNo<1))throw new Error('取込ファイルに空欄または不正な配置No.があります'); validateImportDuplicates(pendingImport); const detail=pendingImport.map(v=>{const old=entries.find(x=>x.destinationCode===v.destinationCode);const changes=[];if(!old)changes.push('新規追加');else{if(old.destinationName!==v.destinationName)changes.push('名称変更');if(Number(old.slotNo)!==v.slotNo)changes.push('配置変更');if(old.enabled!==v.enabled)changes.push('状態変更');}return {v,label:changes.join('・')||'変更なし'};}); const n=(label)=>detail.filter(x=>x.label.includes(label)).length; $('diffSummary').textContent=`新規追加：${n('新規追加')}件\n名称変更：${n('名称変更')}件\n配置変更：${n('配置変更')}件\n状態変更：${n('状態変更')}件\n変更なし：${n('変更なし')}件`; $('diffDetails').textContent=detail.map(x=>`${x.v.destinationCode} ${x.v.destinationName} ${no(x.v.slotNo)}\n${x.label}`).join('\n\n');$('diffDialog').showModal();}catch(err){message(err.message,true);}};
    $('applyImport').onclick=async(e)=>{e.preventDefault();try{await mgr.saveDestinationMasterEntries(pendingImport);$('diffDialog').close();message('マスターを反映しました');await refresh();}catch(err){message(`反映できませんでした（変更は適用されていません）: ${err.message}`,true);}};
    $('exportBtn').onclick=()=>{const csv=['仕分け先コード,仕分け先名,配置No,有効',...entries.map(v=>[v.destinationCode,v.destinationName,v.slotNo,v.enabled].map(x=>`"${String(x).replace(/"/g,'""')}"`).join(','))].join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv'}));a.download='仕分け先マスター.csv';a.click();URL.revokeObjectURL(a.href);};
  });
})();
