import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC = 'public/chat.js';
const OUT = 'public/chat-compose.js';
const B_START = 478, B_END = 940;   // 1-based inclusive
const INSERT_AFTER = 134;            // after initChatAdmin `});`

const sha = s => createHash('sha1').update(s).digest('hex');
const orig = readFileSync(SRC, 'utf8');
const lines = orig.split('\n');

// sanity: line 477 blank (kept), 478 header, 941 next section
if (lines[477-1].trim() !== '') { console.error('line 477 not blank:', JSON.stringify(lines[476])); process.exit(1); }
if (!/Conversation View/.test(lines[478-1])) { console.error('line 478 unexpected:', lines[477]); process.exit(1); }
if (!/Settings Section/.test(lines[941-1])) { console.error('line 941 unexpected:', lines[940]); process.exit(1); }

const block = lines.slice(B_START - 1, B_END).join('\n');

const INSERT = [
  '',
  '// \u2500\u2500\u2500 Compose module (conversation view + send/reply/confirm flow) \u2014 extracted to chat-compose.js',
  'import { initChatCompose, _sendFreeTextDirect, markThreadRead } from "./chat-compose.js?v=20260701_chat_compose_split";',
  'initChatCompose({ _chatFreeTextAllowed, _getChatFreeTextTrimmed });',
];

const MOD = `/**
 * Chat — Compose module (Phase: chat split).
 * Verbatim move of the "Conversation View + Send/Reply/Confirm" block out of
 * chat.js: inline free-text sender, thread reply, mark-read, the New-Message
 * modal, the shared flow-wizard renderer, and the confirm-send pipeline.
 *
 * Imports presentation/data/subscription helpers from the existing chat-*
 * modules. Two chat.js-resident permission helpers are injected via
 * initChatCompose to avoid a circular import:
 *   _chatFreeTextAllowed, _getChatFreeTextTrimmed.
 * chat.js imports _sendFreeTextDirect + markThreadRead back (training reminder /
 * thread-open / subscriptions injection). The window.* handlers self-register.
 */
import { collection, doc, setDoc, updateDoc, writeBatch, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import { chatState } from "./chat-state.js?v=20260627_chat_state_split";
import { isMgrPlus, buildConvId, _trimStr, _memberDisplayNameFromRow, _otherUidFromParticipants } from "./chat-helpers.js?v=20260626_chat_helpers_split";
import { _chatEffectiveLocKey, loadChatUserProfile } from "./chat-data.js?v=20260628_chat_data_b0";
import { renderThreadList, renderConversation, _conversationById, _nameForUid, _nameForUidForSend, _staffDisplayNameForUid, _rememberConversationForList, _openChatModal, _chatRenderFlowWizard, _updateChatSendBtn, _buildFlowRenderedText } from "./chat-ui.js?v=20260628_chat_ui_u3";
import { _unreadCountForUid, _computeChatNavUnreadFromSnapDocs, _paintChatNavBadge } from "./chat-subscriptions.js?v=20260628_chat_subs_split";

let _chatFreeTextAllowed, _getChatFreeTextTrimmed;
export function initChatCompose(deps) {
  _chatFreeTextAllowed = deps._chatFreeTextAllowed;
  _getChatFreeTextTrimmed = deps._getChatFreeTextTrimmed;
}

${block}

export { _sendFreeTextDirect, markThreadRead };
`;

const newLines = [
  ...lines.slice(0, INSERT_AFTER),   // 1..134
  ...INSERT,
  ...lines.slice(INSERT_AFTER, B_START - 1), // 135..477 (keeps blank 477)
  ...lines.slice(B_END),             // 941..end
];
const newContent = newLines.join('\n');

writeFileSync(OUT, MOD);
writeFileSync(SRC, newContent);

console.log('block lines:', B_END - B_START + 1, 'sha', sha(block));
console.log('chat-compose.js lines:', MOD.split('\n').length);
console.log('chat.js:', orig.split('\n').length, '->', newContent.split('\n').length);
