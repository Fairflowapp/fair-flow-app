// chat-state.js
// Single shared mutable state object for the Chat module. Extracted from
// chat.js so data/ui/handlers sub-modules can share one instance. No logic.

export const chatState = {
  chatUserProfile: null,
  chatTemplates: [],
  chatFlows: [],   // { id, title, category, allowedSenders, startStepId, steps: [...] }
  chatSalonUsers: [],
  _chatMembersLoaded: false,
  chatConvsUnsub: null,
  _chatInitialized: false,   // cache flag — skip re-fetching on repeat visits
  _chatUsersLoadKey: '',
  _chatTemplatesLoadKey: '',
  _chatFlowsLoadKey: '',
  _chatUsersLoadPromise: null,
  _chatTemplatesLoadPromise: null,
  _chatFlowsLoadPromise: null,
  _chatSendModalOpening: false,
  chatMsgsUnsub: null,
  chatBadgeUnsub: null,
  chatToastUnsub: null,
  _chatBadgePerfOpenMs: 0,
  _chatBadgePerfRenderLogged: false,
  _chatConvFirstSnapLogged: false,
  _chatNavBadgeFirstSnapLogged: false,
  _chatNavBadgeRenderDoneLogged: false,
  chatEditingTmplId: null,
  chatEditingFlowId: null,
  chatFlowDraft: null,   // { title, allowedSenders, steps } for builder
  chatReplyContext: null,   // { uid, name, conversationId }
  quoteReply: null,         // { id, name, text } — reply to a specific message
  allConversations: [],   // kept in sync by onSnapshot
  lastNonEmptyConversations: [],
  lastRenderedConversations: [],
  lastRenderedThreadListHtml: '',
  cachedConversationsById: {},
  currentThreadFallback: null,
  chatMessagesLoading: false,
  currentMessages: [],   // kept in sync by onSnapshot for open conversation
  currentMessagesConvId: null, // conversation id that currentMessages belong to
  currentConvId: null,   // currently open thread
  chatSendMode: 'template',   // 'template' | 'flow' (free text uses textarea, not this flag)
  chatSelectedFlow: null,
  chatFlowAnswers: [],   // during wizard: [{ stepId, prompt, optionId, label }]
  _chatAuthUid: null,
  _chatAuthSalonId: null,
  _lastChatToastLastMsgMsByConv: new Map(),
  _chatLastConvSnap: null,
};
