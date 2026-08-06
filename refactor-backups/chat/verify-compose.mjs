import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = s => createHash('sha1').update(s).digest('hex');

const backup = readFileSync('refactor-backups/chat/chat.pre-compose.js','utf8');
const neu = readFileSync('public/chat.js','utf8');
const mod = readFileSync('public/chat-compose.js','utf8');
const bl = backup.split('\n');
const truthBlock = bl.slice(477, 940).join('\n'); // 478..940

let pass=true; const ok=(c,m)=>{if(!c)pass=false;console.log((c?'PASS':'FAIL')+' \u2014 '+m);};

ok(sha(truthBlock)==='59eebefae073a5356b3fb2e83ed3d6a106b17d36', 'block sha == extract ('+sha(truthBlock)+')');
ok(mod.includes(truthBlock), 'chat-compose.js contains block verbatim');

// reversibility: strip 4 inserted lines, reinsert block
const nl = neu.split('\n');
const INSERT = ['', '// \u2500\u2500\u2500 Compose module (conversation view + send/reply/confirm flow) \u2014 extracted to chat-compose.js',
  'import { initChatCompose, _sendFreeTextDirect, markThreadRead } from "./chat-compose.js?v=20260701_chat_compose_split";',
  'initChatCompose({ _chatFreeTextAllowed, _getChatFreeTextTrimmed });'];
const insOk = nl.slice(134,138).join('\n') === INSERT.join('\n');
ok(insOk, 'insert block present at lines 135-138');
const without = [...nl.slice(0,134), ...nl.slice(138)];
// extract block from module
const fStart = mod.indexOf('\n\nexport { _sendFreeTextDirect');
const afterInit = mod.indexOf('}\n\n', mod.indexOf('initChatCompose(deps)'));
const modBlock = mod.slice(afterInit+3, fStart);
ok(modBlock===truthBlock, 'module-extracted block == truth block');
const rebuilt = [...without.slice(0,477), ...modBlock.split('\n'), ...without.slice(477)].join('\n');
ok(sha(rebuilt)===sha(backup), 'rebuilt chat.js == backup');
console.log('   backup :', sha(backup));
console.log('   rebuilt:', sha(rebuilt));

// wiring
ok(/import \{ initChatCompose, _sendFreeTextDirect, markThreadRead \} from ".\/chat-compose\.js/.test(neu), 'chat.js imports back initChatCompose/_sendFreeTextDirect/markThreadRead');
ok(/initChatCompose\(\{ _chatFreeTextAllowed, _getChatFreeTextTrimmed \}\)/.test(neu), 'initChatCompose called with 2 deps');
ok(/initChatSubscriptions\(\{[\s\S]*markThreadRead[\s\S]*\}\)/.test(neu), 'markThreadRead still injected into subscriptions');
ok(!/async function _sendFreeTextDirect\b/.test(neu) && !/async function markThreadRead\b/.test(neu), 'no leftover compose fn definitions in chat.js');
ok(/window\.ffSendTrainingReminderChat[\s\S]*_sendFreeTextDirect/.test(neu), 'training reminder still references _sendFreeTextDirect');

console.log('\n'+(pass?'ALL PASS':'*** FAIL ***'));
process.exit(pass?0:1);
