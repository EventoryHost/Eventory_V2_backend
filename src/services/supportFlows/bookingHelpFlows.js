import { answer, branch, helpFlow } from "./helpTopics.js";

const customerFirstName = (customerName) => {
  const first = String(customerName ?? "").trim().split(/\s+/)[0];
  return first === "" ? "the customer" : first;
};

const buildFacts = (raw) => {
  const first = customerFirstName(raw.customerName);
  const about = `${raw.customerName}'s ${raw.eventName} on ${raw.eventDate} (${raw.bookingRef})`;
  const setupBy = raw.setupDue == null ? "before the event starts" : `by ${raw.setupDue}`;
  const amount = raw.amountDue ?? "the amount due";
  return { raw, first, about, setupBy, amount };
};

const introFor = ({ raw, first, about, setupBy, amount }) => {
  switch (raw.stage) {
    case "newBooking":
      return (
        `I can see you're looking at a new booking request from ${raw.customerName}: ${raw.eventName} on ${raw.eventDate} (${raw.bookingRef}).` +
        (raw.timeLeftToRespond == null ? "" : ` You have ${raw.timeLeftToRespond} left to respond.`)
      );
    case "inDiscussion":
      return `This is about ${about}. Your proposal is with ${first} and you're waiting for their reply.`;
    case "confirmed":
      return `This is about ${about}. The booking is confirmed and an Event Manager is assigned.`;
    case "checkedIn":
      return (
        `This is about ${about}. It's event day! You're checked in` +
        (raw.venue == null ? "" : ` at ${raw.venue}`) +
        (raw.setupDue == null ? "." : ` and setup is due by ${raw.setupDue}.`)
      );
    case "settingUp":
      return `This is about ${about}. You're setting up. Finish ${setupBy} and share photos with ${first}.`;
    case "takePayment":
      return (
        `This is about ${about}. Setup is done. Request ${amount}` +
        (raw.eventStart == null ? "." : ` before the event starts at ${raw.eventStart}.`)
      );
    case "live":
      return (
        `This is about ${about}. The event is live` + (raw.eventEnd == null ? "." : ` and ends at ${raw.eventEnd}.`)
      );
    case "wrappingUp":
      return (
        `This is about ${about}. The event ` +
        (raw.eventEnd == null ? "has finished" : `finished at ${raw.eventEnd}`) +
        ". Clear the venue, then mark teardown done."
      );
    case "completed":
      return `This is about ${about}. The event is completed and the window to raise issues has closed.`;
    case "cancelled":
      return (
        `This is about ${about}. ` +
        (raw.cancelledByCustomer ? `${first} cancelled` : "You cancelled") +
        " this booking and your slot is free again."
      );
    default:
      return "";
  }
};

const talkToEm = answer(
  "bk.talkToEm",
  "Talk to my Event Manager",
  "Open Inbox, EM Chats, Event Inquiries and pick this booking's chat.",
);

const leftSomething = answer(
  "bk.leftSomething",
  "I left something at the venue",
  "Tell your Event Manager. They'll sort it out with the venue.",
);

const raiseIssue = ({ untilSetupPaid }) =>
  answer(
    "bk.raiseIssue",
    "Raise an issue",
    untilSetupPaid
      ? "You can raise an issue until your setup is done and its payment is received. Choose Something else to tell us and we'll open a ticket."
      : "You can raise an issue until the payment is received. Choose Something else to tell us and we'll open a ticket.",
  );

const milestoneDatesShort = answer(
  "bk.milestones.datesDontFit",
  "My milestone dates don't fit this event",
  "This happens when the event is sooner than your milestones allow. Update the schedule for this booking from Payment Timeline, then Edit.",
);

const milestoneUpdateShort = answer(
  "bk.milestones.update",
  "How do I update the schedule?",
  "Open Booking Details, Payment Timeline, then Edit. Change the amount or due date, review the changes and tap Save schedule. Payments already received don't change.",
);

const milestoneToldShort = answer(
  "bk.milestones.told",
  "Will the customer be told?",
  "Yes. The customer is notified of the new schedule.",
);

const milestonesShort = branch("bk.milestones", "Payment Milestone related issue", "What do you need?", [
  milestoneDatesShort,
  milestoneUpdateShort,
  milestoneToldShort,
]);

const newBooking = (f) => [
  branch("bk.booking", "Booking related issue", "What's the issue?", [
    answer(
      "bk.booking.accept",
      "How do I accept this request?",
      "Check the event details, your slot and the package, then tap Acknowledge request before it expires." +
        (f.raw.timeLeftToRespond == null ? "" : ` You have ${f.raw.timeLeftToRespond} left.`),
    ),
    answer(
      "bk.booking.noResponse",
      "What if I don't respond in time?",
      f.raw.expiresAt == null
        ? "The request expires and you can't accept it after that."
        : `The request expires at ${f.raw.expiresAt} and you can't accept it after that.`,
    ),
    answer(
      "bk.booking.notFree",
      "I'm not free on this date",
      "Decline the request so the customer can book someone else. Block busy dates in Calendar so this doesn't happen again.",
    ),
    ...(f.raw.isFreeBooking
      ? [
          answer(
            "bk.booking.free",
            "What is a Free booking?",
            "The customer hasn't paid an advance for this booking yet. Payments follow your payment milestones once you accept.",
          ),
        ]
      : []),
  ]),
  branch("bk.items", "Items related issue", "What about the items?", [
    answer(
      "bk.items.which",
      "Which items are in this booking?",
      "The setups and items you added in Step 2 of the package the customer booked.",
    ),
    answer(
      "bk.items.extra",
      "Customer asked for something extra",
      "Their extras are listed under Requests. If something isn't in your package, add it as an add-on or ask your Event Manager.",
    ),
    answer(
      "bk.items.unavailable",
      "An item isn't available now",
      "Update the item in Step 2 of your package before you accept, or tell your Event Manager so the customer is informed.",
    ),
  ]),
  branch("bk.payment", "Payment related issue", "What's the issue?", [
    answer(
      "bk.payment.when",
      "When will I get paid?",
      "The customer pays in steps, by your payment milestones. Each payment reaches your bank 1–2 days after the customer pays it.",
    ),
    answer(
      "bk.payment.where",
      "Where do I see payments for this booking?",
      "Open Booking Details, then Payment Timeline. It shows what you've received and the next payment due.",
    ),
    answer(
      "bk.payment.missing",
      "Customer says they paid, I can't see it",
      "Payments can take a little time to show. If it's still missing, choose Not quite, call me and we'll check it.",
    ),
  ]),
  branch("bk.milestones", "Payment Milestone related issue", "What do you need?", [
    answer(
      "bk.milestones.what",
      "What are payment milestones?",
      "The steps in which the customer pays you: Token, Advances and Final pay. You set them in Booking Settings before publishing your package.",
    ),
    answer(
      "bk.milestones.datesDontFit",
      "My milestone dates don't fit this event",
      "This happens when the event is sooner than your milestones allow, like an event 4 days away with a payment due 10 days before. Update the schedule for this booking before you accept it.",
    ),
    answer(
      "bk.milestones.update",
      "How do I update the schedule?",
      "Open Booking Details, Payment Timeline, then Edit. Change the amount or due date of each payment, review the changes and tap Save schedule. Amounts can't add up to more than the total.",
    ),
    answer(
      "bk.milestones.told",
      "Will the customer be told?",
      "Yes. The customer is notified of the new schedule. Payments you've already received don't change.",
    ),
    answer(
      "bk.milestones.allFuture",
      "Change it for all future bookings",
      "Edit your package's Booking Settings, Step 3, Payment Milestones. New bookings for that package use the new milestones.",
    ),
  ]),
];

const inDiscussion = (f) => [
  branch("bk.booking", "Booking related issue", "What's the issue?", [
    answer(
      "bk.booking.whenReply",
      `When will ${f.first} reply?`,
      "There's no fixed time. You'll be notified as soon as they accept or ask for changes.",
    ),
    answer(
      "bk.booking.askedChanges",
      `${f.first} asked for changes`,
      "Open the revised proposal to see what changed. Accept it, or send a new proposal with your changes.",
    ),
    answer(
      "bk.booking.editProposal",
      "Can I edit the proposal I sent?",
      `No. You can send a revised proposal only after ${f.first} asks for changes.`,
    ),
  ]),
  branch("bk.items", "Items related issue", "What about the items?", [
    answer(
      "bk.items.changeProposal",
      "Change items in my proposal",
      `You can change items only after ${f.first} asks for changes. Then send a revised proposal with what you can provide.`,
    ),
    answer(
      "bk.items.notOffered",
      `${f.first} wants an item I don't offer`,
      "Add it to your proposal as an add-on with a price, or ask your Event Manager.",
    ),
  ]),
  branch("bk.payment", "Payment related issue", "What's the issue?", [
    answer(
      "bk.payment.changePrice",
      "Change the price in my proposal",
      `You can change the price only after ${f.first} asks for changes, in a revised proposal. They have to accept it.`,
    ),
    answer(
      "bk.payment.start",
      "When do payments start?",
      "Once the booking is confirmed, the customer pays by your payment milestones.",
    ),
  ]),
  milestonesShort,
];

const confirmed = (f) => [
  branch("bk.booking", "Booking related issue", "What's the issue?", [
    answer(
      "bk.booking.nextSteps",
      "What are my next steps?",
      "Keep an eye on the Payment Timeline, then check in at the venue on the event day.",
    ),
    answer(
      "bk.booking.changeDate",
      "Change the event date or time",
      `Changes need ${f.first}'s agreement. Ask your Event Manager to arrange it.`,
    ),
    answer(
      "bk.booking.cancel",
      "I need to cancel",
      "Choose Not quite, call me and we'll help. Cancelling a confirmed booking follows your cancellation policy.",
    ),
  ]),
  branch("bk.items", "Items related issue", "What about the items?", [
    answer(
      "bk.items.customerChange",
      `${f.first} wants to change items`,
      `Ask your Event Manager. Changes after confirmation are agreed with ${f.first} first.`,
    ),
    answer(
      "bk.items.noLongerAvailable",
      "An item is no longer available",
      `Tell your Event Manager now so they can offer ${f.first} an alternative.`,
    ),
  ]),
  branch("bk.payment", "Payment related issue", "What's the issue?", [
    answer(
      "bk.payment.nextDue",
      "When is the next payment due?",
      "Open Booking Details, Payment Timeline. It shows the next payment due and what you've received.",
    ),
    answer(
      "bk.payment.late",
      `${f.first} hasn't paid on time`,
      `Your Event Manager follows up with ${f.first}. If it's still unpaid, choose Not quite, call me.`,
    ),
    answer(
      "bk.payment.myMoney",
      "When will I get my money?",
      "Each payment reaches your bank 1–2 days after the customer pays it.",
    ),
  ]),
  milestonesShort,
  talkToEm,
];

const setupWhenAnswer = (raw) => {
  if (raw.setupDue == null) return "Before the event starts.";
  if (raw.eventStart == null || raw.eventStart === raw.setupDue) return `By ${raw.setupDue}, when the event starts.`;
  return `By ${raw.setupDue}, before the event starts at ${raw.eventStart}.`;
};

const checkedIn = (f) => [
  branch("bk.setup", "Setup", "What do you need?", [
    answer("bk.setup.when", "When should setup be done?", setupWhenAnswer(f.raw)),
    answer(
      "bk.setup.late",
      "I'm running late",
      `Tell your Event Manager straight away so they can update ${f.first}.`,
    ),
  ]),
  answer(
    "bk.onGroundContact",
    "On-ground contact",
    "Tap Assign on-ground contact and share the link. They can view and update today's schedule.",
  ),
  answer(
    "bk.paymentRequest",
    "Payment request",
    f.raw.amountDue == null
      ? "Nothing is due for this booking right now."
      : `You can request ${f.raw.amountDue} now or after setup is done.`,
  ),
  raiseIssue({ untilSetupPaid: true }),
  talkToEm,
];

const settingUp = (f) => [
  branch("bk.photos", "Uploading setup photos", "What do you need?", [
    answer(
      "bk.photos.why",
      "Why share photos?",
      `${f.first} sees your setup is ready, and it's a record if any issue comes up later.`,
    ),
    answer(
      "bk.photos.notWorking",
      "Upload isn't working",
      "Check your connection and upload a few photos at a time.",
    ),
  ]),
  answer(
    "bk.missingDamaged",
    "Something is missing or damaged",
    `Tell your Event Manager now so they can update ${f.first} and help find a fix.`,
  ),
  answer(
    "bk.paymentRequest",
    "Payment request",
    f.raw.amountDue == null
      ? "Nothing is due for this booking right now."
      : `Once setup is done and your photos are uploaded, request ${f.raw.amountDue}.`,
  ),
  raiseIssue({ untilSetupPaid: true }),
  talkToEm,
];

const takePayment = (f) => [
  answer(
    "bk.pay.how",
    "How do I request payment?",
    `Tap Request payment. ${f.first} gets the request and you're notified when it's paid.`,
  ),
  answer(
    "bk.pay.notPaid",
    `${f.first} hasn't paid yet`,
    `It can take a few minutes. If it's still pending close to ${f.raw.eventStart ?? "the event start"}, your Event Manager will follow up with ${f.first}.`,
  ),
  answer(
    "bk.pay.startBeforePaid",
    `Can the event start before ${f.first} pays?`,
    "Yes, the event can go ahead. Just make sure your setup photos are uploaded and the payment request is sent.",
  ),
  answer(
    "bk.pay.wrongAmount",
    "The amount looks wrong",
    "It comes from your payment schedule. If it's wrong, choose Not quite, call me and we'll check it.",
  ),
  raiseIssue({ untilSetupPaid: false }),
  talkToEm,
];

const live = (f) => [
  answer(
    "bk.live.request",
    "A customer request came in",
    `Open Customer requests from Today's schedule. Accept what you can deliver and tell ${f.first} about anything you can't.`,
  ),
  answer(
    "bk.live.update",
    `Share an update with ${f.first}`,
    `Use Share an update to send ${f.first} a message or photos during the event.`,
  ),
  answer(
    "bk.live.contact",
    "Change the on-ground contact",
    f.raw.onGroundContact == null
      ? "Open Manage on-ground contact."
      : `Open Manage on-ground contact. ${f.raw.onGroundContact} is the current contact.`,
  ),
  answer(
    "bk.live.wrong",
    "Something went wrong",
    "Choose Not quite, call me and a specialist will call you right away.",
  ),
  talkToEm,
];

const wrappingUp = (f) => [
  answer("bk.wrap.teardown", "Teardown", "Pack up, clear the venue and tap Mark teardown done."),
  answer(
    "bk.wrap.complete",
    "Mark event as completed",
    "Once the venue is clear, tap Mark event as completed. This closes the booking.",
  ),
  leftSomething,
  answer(
    "bk.wrap.payment",
    "When do I get the payment?",
    f.raw.amountDue == null
      ? "Each payment reaches your bank 1–2 days after the customer paid."
      : `${f.raw.amountDue} is confirmed. It reaches your bank 1–2 days after the customer paid.`,
  ),
];

const completed = () => [
  branch("bk.payment", "Payment related issue", "What's the issue?", [
    answer(
      "bk.payment.noPayout",
      "I haven't received my payout",
      "Payouts reach your bank 1–2 days after each payment. If it's later, choose Not quite, call me.",
    ),
    answer("bk.payment.all", "Where do I see all payments?", "Open Booking Details, Payment Timeline."),
  ]),
  answer(
    "bk.whyNoIssue",
    "Why can't I raise an issue?",
    "Issues can be raised only until your setup is done and its payment is received on the event day. Both happened for this booking, so the window has closed.",
  ),
  leftSomething,
];

const cancelled = (f) => [
  ...(!f.raw.cancelledByCustomer
    ? [
        answer(
          "bk.cancel.mistake",
          "I cancelled by mistake",
          `A cancelled booking can't be restored. ${f.first} would need to send a new booking request.`,
        ),
      ]
    : []),
  answer("bk.cancel.token", "What happens to the token?", "It's refunded to the customer."),
  answer(
    "bk.cancel.slot",
    "Is my slot free now?",
    f.raw.slot == null
      ? "Yes. The slot is open for new bookings again."
      : `Yes. ${f.raw.slot} is open for new bookings again.`,
  ),
];

const TOPICS_BY_STAGE = {
  newBooking,
  inDiscussion,
  confirmed,
  checkedIn,
  settingUp,
  takePayment,
  live,
  wrappingUp,
  completed,
  cancelled,
};

export function bookingHelpFlowFor(facts) {
  const f = buildFacts(facts);
  const topicsFor = Object.hasOwn(TOPICS_BY_STAGE, facts.stage) ? TOPICS_BY_STAGE[facts.stage] : null;
  return helpFlow({
    fallbackSummary: introFor(f),
    offersEndChat: true,
    topics: topicsFor ? topicsFor(f) : [],
  });
}
