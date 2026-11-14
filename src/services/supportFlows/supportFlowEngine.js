import { bookingHelpFlowFor } from "./bookingHelpFlows.js";
import { businessProfileHelpFlowFor } from "./businessProfileHelpFlows.js";
import { documentHelpFlowFor } from "./documentHelpFlows.js";
import { findTopic } from "./helpTopics.js";
import { packageHelpFlowFor } from "./packageHelpFlows.js";
import { publishHelpFlowFor } from "./publishHelpFlows.js";

export const OPTION_IDS = {
  resolved: "end.resolved",
  callMe: "end.callMe",
  somethingElse: "end.somethingElse",
  ticket: "end.ticket",
  endChat: "end.endChat",
};

export const OUTCOMES = {
  continue: "continue",
  resolved: "resolved",
  callRequested: "call_requested",
  ticket: "ticket",
};

const WHAT_DO_YOU_NEED = "What do you need help with?";
const DID_THAT_HELP = "Did that help?";
const SOMETHING_ELSE_LABEL = "Something else";
const RESOLVED_NOTE = "Marked as resolved";
const FEEDBACK_OPTIONS = [
  { id: OPTION_IDS.resolved, label: "Yes, that helps" },
  { id: OPTION_IDS.callMe, label: "Not quite, call me" },
  { id: OPTION_IDS.somethingElse, label: "Help with something else" },
];

const flowFor = (chat) => {
  const context = chat.context ?? {};
  switch (chat.topic) {
    case "publish_package":
      return publishHelpFlowFor({ vendorType: context.vendorType ?? null });
    case "booking":
      return bookingHelpFlowFor(context.booking ?? {});
    case "business_profile":
      return businessProfileHelpFlowFor(context.profileField);
    case "personal_documents":
      return documentHelpFlowFor(context.documentField);
    default:
      return packageHelpFlowFor({ step: chat.step ?? 0, vendorType: context.vendorType ?? null });
  }
};

const introOf = (chat, flow, { returning = false } = {}) => {
  const context = chat.context ?? {};
  const name = (context.packageName ?? "").trim();
  const opening = (() => {
    switch (chat.topic) {
      case "booking":
        return "Hi!";
      case "business_profile":
        return `${returning ? "Welcome back!" : "Hi!"} You're setting up your business profile,`;
      case "personal_documents":
        return `${returning ? "Welcome back!" : "Hi!"} You're verifying your personal documents,`;
      case "publish_package":
        return `Hi! You're about to publish ${name ? `“${name}”` : "your package"} (${context.variantName} variant).`;
      default:
        return `Hi! You're on Step ${chat.step} of ${context.totalSteps}, ${context.stepName}${name ? `, for “${name}”` : ""}.`;
    }
  })();
  return flow.fallbackSummary ? `${opening} ${flow.fallbackSummary}` : opening;
};

const optionOf = (topic) => ({ id: topic.id, label: topic.label });

const endChatOptions = (flow) => (flow.endChat ? [{ id: OPTION_IDS.endChat, label: flow.endChat.label }] : []);

const rootOptions = (flow) => [
  ...flow.topics.map(optionOf),
  { id: OPTION_IDS.ticket, label: SOMETHING_ELSE_LABEL },
  ...endChatOptions(flow),
];

const bot = (...texts) => texts.map((text) => ({ from: "bot", text }));
const vendor = (text) => ({ from: "vendor", text });
const tutorialLine = (tutorial) => ({ from: "bot", text: tutorial.title, tutorialId: tutorial.id });

export const startFlow = (chat, { returning = false } = {}) => {
  const flow = flowFor(chat);
  return { lines: bot(introOf(chat, flow, { returning }), WHAT_DO_YOU_NEED), options: rootOptions(flow) };
};

export const selectOption = (chat, optionId, { ticketNumber } = {}) => {
  const option = (chat.options ?? []).find((o) => o.id === optionId);
  if (!option || chat.status !== "automated") return null;
  const chose = vendor(option.label);

  switch (optionId) {
    case OPTION_IDS.resolved:
      return {
        outcome: OUTCOMES.resolved,
        options: [],
        note: RESOLVED_NOTE,
        lines: [
          chose,
          ...bot("Great, glad that helped. You can reopen this chat any time from Help & Support."),
        ],
      };
    case OPTION_IDS.callMe:
      return {
        outcome: OUTCOMES.callRequested,
        options: [],
        lines: [chose, ...bot("No problem. A support specialist will call you in the next 10 minutes.")],
      };
    case OPTION_IDS.ticket:
      return {
        outcome: OUTCOMES.ticket,
        options: [],
        lines: [
          chose,
          ...bot(
            `I've opened ticket #${ticketNumber} for you. A support specialist will reply in this chat within 2 hours.`
          ),
        ],
      };
  }

  const flow = flowFor(chat);
  if (optionId === OPTION_IDS.endChat) {
    const { reply, note = RESOLVED_NOTE } = flow.endChat ?? {};
    return { outcome: OUTCOMES.resolved, options: [], note, lines: [chose, ...(reply ? bot(reply) : [])] };
  }
  if (optionId === OPTION_IDS.somethingElse) {
    return {
      outcome: OUTCOMES.continue,
      options: rootOptions(flow),
      lines: [chose, ...bot("Sure. Here's everything I can help with here.", "What else do you need help with?")],
    };
  }

  const topic = findTopic(flow.topics, optionId);
  if (!topic) return null;
  if (topic.children.length > 0) {
    return {
      outcome: OUTCOMES.continue,
      options: [...topic.children.map(optionOf), ...endChatOptions(flow)],
      lines: [chose, ...bot(topic.prompt)],
    };
  }
  return {
    outcome: OUTCOMES.continue,
    options: FEEDBACK_OPTIONS,
    lines: [
      chose,
      ...bot(topic.answer),
      ...(flow.tutorial ? [tutorialLine(flow.tutorial)] : []),
      ...bot(DID_THAT_HELP),
    ],
  };
};
