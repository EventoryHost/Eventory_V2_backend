import { answer, branch, helpFlow } from "./helpTopics.js";

const DECORATOR_VENDOR_TYPE = "Decorator";

const SUMMARY = "When you tap Send For Verification, an Event Manager checks it before it goes live on Eventory.";

const VARIANTS_ID = "pub.variants";
const VARIANTS_LABEL = "My variants";
const VARIANTS_PROMPT = "What about them?";
const PRICES_ID = "pub.variants.prices";
const PRICES_LABEL = "Prices differ between variants";
const WRONG_CONTENT_ID = "pub.wrongContent";
const WRONG_CONTENT_ANSWER =
  "Tap Edit this variant. It takes you back to Package Setup, where you can change any of the 4 steps.";

const afterSend = branch("pub.afterSend", "What happens after I send it?", "What would you like to know?", [
  answer(
    "pub.afterSend.who",
    "Who verifies my package?",
    "An Eventory Event Manager checks your details, prices and media before the package goes live.",
  ),
  answer(
    "pub.afterSend.howLong",
    "How long does it take?",
    "Usually 2–4 business hours. We'll notify you as soon as it's done.",
  ),
  answer(
    "pub.afterSend.customers",
    "Can customers see it during review?",
    "No. It goes live on Eventory only after it's verified.",
  ),
]);

const tracking = branch("pub.tracking", "Tracking my package status", "What do you need?", [
  answer(
    "pub.tracking.where",
    "Where do I check the status?",
    "Open the Inventory tab. Your package shows Under verification until the Event Manager finishes.",
  ),
  answer(
    "pub.tracking.meaning",
    "What do the statuses mean?",
    "Under verification: being checked. Verified: live on Eventory. Changes needed: fix the notes and send it again.",
  ),
  answer(
    "pub.tracking.notify",
    "Will I be told when it's done?",
    "Yes. We'll notify you and update the Inventory tab when it's verified or if changes are needed.",
  ),
]);

const changes = branch("pub.changes", "If changes are needed", "What about it?", [
  answer(
    "pub.changes.where",
    "Where do I see what to change?",
    "Open the package in the Inventory tab. The Event Manager's notes are listed there.",
  ),
  answer(
    "pub.changes.resend",
    "How do I send it again?",
    "Edit the package from Inventory, fix each note, then tap Send For Verification again.",
  ),
]);

const variantsTogether = answer(
  "pub.variants.together",
  "Are all variants sent together?",
  "Yes. Premium, Standard and Basic are verified together. Use the tabs at the top to check each one first.",
);

const viewAsCustomer = answer(
  "pub.viewAsCustomer",
  "What's “View as customer” for?",
  "It shows your package exactly as customers will see it once it's listed on the Eventory marketplace. Use it to check your photos, title and price before you send it.",
);

const decoratorFlow = helpFlow({
  fallbackSummary: SUMMARY,
  topics: [
    afterSend,
    tracking,
    changes,
    branch(VARIANTS_ID, VARIANTS_LABEL, VARIANTS_PROMPT, [
      variantsTogether,
      answer(PRICES_ID, PRICES_LABEL, "That's expected. Each variant has its own setups, add-ons and price."),
    ]),
    viewAsCustomer,
    answer(WRONG_CONTENT_ID, "Setups, add-ons or media are wrong", WRONG_CONTENT_ANSWER),
  ],
});

const genericFlow = helpFlow({
  fallbackSummary: SUMMARY,
  topics: [
    afterSend,
    tracking,
    changes,
    branch(VARIANTS_ID, VARIANTS_LABEL, VARIANTS_PROMPT, [
      variantsTogether,
      answer(PRICES_ID, PRICES_LABEL, "That's expected. Each variant has its own add-ons and price."),
    ]),
    viewAsCustomer,
    answer(WRONG_CONTENT_ID, "Add-ons or media are wrong", WRONG_CONTENT_ANSWER),
  ],
});

export const publishHelpFlowFor = ({ vendorType } = {}) =>
  vendorType === DECORATOR_VENDOR_TYPE ? decoratorFlow : genericFlow;
