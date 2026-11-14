export const answer = (id, label, text) => ({ id, label, answer: text, children: [] });

export const branch = (id, label, prompt, children) => ({ id, label, prompt, children });

export const END_CHAT = {
  label: "End chat",
  reply: "Thanks for reaching out. This chat is now closed. Tap Help any time if you need us again.",
  note: "Chat ended",
};

export const helpFlow = ({ fallbackSummary, topics, endChat = null, tutorial = null }) => ({
  fallbackSummary,
  topics,
  endChat,
  tutorial,
});

export const findTopic = (topics, topicId) => {
  for (const topic of topics) {
    if (topic.id === topicId) return topic;
    const match = findTopic(topic.children, topicId);
    if (match) return match;
  }
  return null;
};
