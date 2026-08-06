/**
 * Generic Flow Builder Engine
 *
 * UI/state helpers shared by modules that need a decision-tree builder.
 * This file intentionally has no Firestore, Chat, Floor, permission, or modal
 * dependencies. Each product module owns its own storage adapter.
 */

function makeId(prefix) {
  return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createEmptyFlowDraft(overrides = {}) {
  return {
    title: '',
    category: '',
    allowedSenders: [],
    steps: [],
    ...overrides
  };
}

export function ensureFlowDraft(draft, defaults = {}) {
  const next = draft || createEmptyFlowDraft(defaults);
  if (!Array.isArray(next.steps)) next.steps = [];
  return next;
}

export function createFlowStep(order = 0) {
  return {
    id: makeId('s'),
    prompt: '',
    order,
    options: [createFlowOption()]
  };
}

export function createFlowOption(overrides = {}) {
  return {
    id: makeId('o'),
    label: '',
    finish: true,
    ...overrides
  };
}

export function addFlowStep(draft, defaults = {}) {
  const next = ensureFlowDraft(draft, defaults);
  next.steps.push(createFlowStep(next.steps.length));
  return next;
}

export function removeFlowStepAt(draft, idx, defaults = {}) {
  const next = ensureFlowDraft(draft, defaults);
  if (next.steps[idx] === undefined) return next;
  next.steps.splice(idx, 1);
  return next;
}

export function removeFlowStepById(draft, stepId, defaults = {}) {
  const next = ensureFlowDraft(draft, defaults);
  const idx = next.steps.findIndex((step) => step && step.id === stepId);
  if (idx < 0) return next;
  return removeFlowStepAt(next, idx, defaults);
}

export function addFlowOptionAt(draft, stepIdx, defaults = {}) {
  const next = ensureFlowDraft(draft, defaults);
  const step = next.steps[stepIdx];
  if (!step) return next;
  if (!Array.isArray(step.options)) step.options = [];
  step.options.push(createFlowOption());
  return next;
}

export function addFlowOptionByStepId(draft, stepId, defaults = {}) {
  const next = ensureFlowDraft(draft, defaults);
  const step = next.steps.find((candidate) => candidate && candidate.id === stepId);
  if (!step) return next;
  if (!Array.isArray(step.options)) step.options = [];
  step.options.push(createFlowOption());
  return next;
}

export function removeFlowOptionAt(draft, stepIdx, optIdx, defaults = {}) {
  const next = ensureFlowDraft(draft, defaults);
  const options = next.steps[stepIdx] && next.steps[stepIdx].options;
  if (!Array.isArray(options)) return next;
  options.splice(optIdx, 1);
  return next;
}

export function removeFlowOptionByStepId(draft, stepId, optIdx, defaults = {}) {
  const next = ensureFlowDraft(draft, defaults);
  const step = next.steps.find((candidate) => candidate && candidate.id === stepId);
  if (!step || !Array.isArray(step.options)) return next;
  step.options.splice(optIdx, 1);
  return next;
}

export function addFlowStepAndLinkAt(draft, stepIdx, optIdx, defaults = {}) {
  const next = ensureFlowDraft(draft, defaults);
  const newStep = createFlowStep(next.steps.length);
  next.steps.push(newStep);
  const opt = next.steps[stepIdx] && next.steps[stepIdx].options && next.steps[stepIdx].options[optIdx];
  linkOptionToStep(opt, newStep.id);
  return next;
}

export function addFlowStepAndLinkByStepId(draft, stepId, optIdx, defaults = {}) {
  const next = ensureFlowDraft(draft, defaults);
  const newStep = createFlowStep(next.steps.length);
  next.steps.push(newStep);
  const step = next.steps.find((candidate) => candidate && candidate.id === stepId);
  const opt = step && step.options && step.options[optIdx];
  linkOptionToStep(opt, newStep.id);
  return next;
}

export function unlinkFlowOption(draft, stepId, optIdx, defaults = {}) {
  const next = ensureFlowDraft(draft, defaults);
  const step = next.steps.find((candidate) => candidate && candidate.id === stepId);
  const opt = step && step.options && step.options[optIdx];
  if (!opt) return next;
  opt.nextStepId = null;
  opt.finish = true;
  return next;
}

export function collectFlowStepsFromDom(config) {
  const {
    rootSelector,
    nodeSelector,
    stepIdAttr = 'data-step-id',
    promptSelector,
    optionsContainerClass,
    optionBlockClass,
    optionLabelSelector,
    optionNextSelector,
    draft
  } = config || {};
  const root = rootSelector ? document.querySelector(rootSelector) : document;
  const nodes = root ? root.querySelectorAll(nodeSelector) : [];
  const steps = [];

  nodes.forEach((node) => {
    const stepId = node.getAttribute(stepIdAttr);
    if (!stepId) return;
    const prompt = (node.querySelector(promptSelector)?.value ?? '').trim();
    const options = [];
    const optsContainer = directChildByClass(node, optionsContainerClass);
    const existingStep = draft && Array.isArray(draft.steps)
      ? draft.steps.find((step) => step && step.id === stepId)
      : null;

    directChildrenByClass(optsContainer, optionBlockClass).forEach((block, oidx) => {
      const label = (block.querySelector(optionLabelSelector)?.value ?? '').trim();
      const nextStepId = (block.querySelector(optionNextSelector)?.value ?? '').trim();
      const existingOpt = existingStep && existingStep.options && existingStep.options[oidx];
      options.push({
        id: existingOpt && existingOpt.id ? existingOpt.id : makeId(`o_${oidx}_`),
        label,
        order: oidx,
        nextStepId: nextStepId || null,
        finish: !nextStepId
      });
    });

    steps.push({ id: stepId, prompt, order: steps.length, options });
  });

  return steps;
}

export function directChildrenByClass(node, className) {
  return Array.from(node && node.children ? node.children : []).filter((child) =>
    child.classList && child.classList.contains(className)
  );
}

export function directChildByClass(node, className) {
  return directChildrenByClass(node, className)[0] || null;
}

function linkOptionToStep(opt, stepId) {
  if (!opt) return;
  opt.nextStepId = stepId;
  opt.finish = false;
}

