const assert = require('node:assert/strict');
const fs = require('node:fs');

const manager = fs.readFileSync('js/sort-state-manager.js', 'utf8');
const importer = fs.readFileSync('js/pages/sort-import.js', 'utf8');
const wall = fs.readFileSync('js/pages/sort-wall.js', 'utf8');
const masterPage = fs.readFileSync('sort-master.html', 'utf8');
const masterScript = fs.readFileSync('js/pages/sort-master.js', 'utf8');

assert.match(manager, /collection\('users'\).*collection\('sortDestinationMaster'\)/);
assert.match(manager, /encodeURIComponent\(String\(code\)\.trim\(\)\)/);
assert.doesNotMatch(manager, /tx\.get\(this\.destinationMaster\(\)\)/);
assert.match(manager, /async saveDestinationMasterEntries\(importEntries\)/);
assert.match(manager, /MAX_DESTINATION_MASTER_IMPORT_ENTRIES = 100/);
assert.match(masterPage, /id="entryError"[^>]*role="alert"/);
assert.match(masterScript, /entryMessage\('仕分け先コードが重複しています'\)/);
assert.match(importer, /dcode: readRequiredColumn\('colDestCode'/);
assert.match(importer, /masterEntries\.filter\(\(v\) => v\.enabled\)/);
assert.match(importer, /destinationName: master\.destinationName/);
assert.ok(importer.indexOf('if (missing.size)') < importer.indexOf('replaceActiveBatch('), '未登録検証は稼働バッチ切替より先に行う');
assert.ok(importer.indexOf('if (disabled.size)') < importer.indexOf('replaceActiveBatch('), '無効検証は稼働バッチ切替より先に行う');
assert.doesNotMatch(importer, /closeActiveBatchForReplacement/);
assert.match(wall, /Array\.from\(\{ length: count \}/);
assert.match(wall, /vacant: true/);
assert.doesNotMatch(wall, /\.slice\(start - 1, start - 1 \+ count\)/);

console.log('sort destination master checks passed');
