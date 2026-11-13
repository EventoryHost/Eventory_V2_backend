import { answer, helpFlow } from "./helpTopics.js";

const TUTORIAL = { id: "business-profile", title: "Setting up your business profile" };

const END_CHAT = {
  label: "End chat",
  reply: "Thanks for reaching out. This chat is now closed. Tap Help any time if you need us again.",
  note: "Chat ended",
};

const CAPACITY_ANSWER = "It helps us recommend bookings that match your capacity.";

const FIELDS = {
  businessName: {
    name: "Business name",
    about: "the name customers see first on your profile",
    topics: [
      answer(
        "bp.name.what",
        "What should I enter?",
        "Use the name customers know you by, like “Raju Tent Wale”. If you're a freelancer, you can use your own name."
      ),
      answer(
        "bp.name.none",
        "I don't have a business name",
        "If you're an individual or a freelancer, tick the checkbox “I operate as an individual”. Your business name then becomes optional."
      ),
      answer("bp.name.where", "Where will customers see it?", "On your business profile and your package listings."),
    ],
  },
  pointOfContact: {
    name: "Point of contact",
    about: "the person customers and Eventory will reach out to for booking-related communication",
    topics: [
      answer(
        "bp.poc.who",
        "Who should I enter?",
        "The person who will handle your bookings. Customers and Eventory will contact them."
      ),
      answer(
        "bp.poc.aadhaar",
        "Whose Aadhaar should the name match?",
        "The name must match the Aadhaar card of the person whose name you enter as the POC."
      ),
      answer(
        "bp.poc.why",
        "Why do you need a POC?",
        "So customers and your Event Manager know who to reach for booking-related communication."
      ),
    ],
  },
  email: {
    name: "Email",
    about: "the email of the person who will handle your bookings",
    topics: [
      answer("bp.email.whose", "Whose email should I use?", "Use the email of the person who will handle your bookings."),
      answer(
        "bp.email.why",
        "Why do you need my email?",
        "To send booking updates and important notices about your account."
      ),
    ],
  },
  teamSize: {
    name: "Team size",
    about: "how many people work in your team, including you and your regular event crew",
    topics: [
      answer("bp.team.who", "Who counts as my team?", "Include yourself and your regular event crew."),
      answer("bp.team.changes", "My team size changes", "Pick the range that is true for most of the year."),
      answer("bp.team.why", "Why do you ask?", CAPACITY_ANSWER),
    ],
  },
  bookingsPerYear: {
    name: "Bookings per year",
    about: "how many bookings you handle in a year",
    topics: [
      answer(
        "bp.bookings.count",
        "How do I count my bookings?",
        "Pick the range closest to the number of events you handle in a year."
      ),
      answer("bp.bookings.starting", "I'm just starting", "Choose 0 – 24 bookings/year."),
      answer("bp.bookings.why", "Why do you ask?", CAPACITY_ANSWER),
    ],
  },
  experience: {
    name: "Experience",
    about: "how many years you've been in the business",
    topics: [
      answer(
        "bp.experience.freelance",
        "Do I count years as a freelancer?",
        "Yes. Count all the years you've worked in this business."
      ),
      answer("bp.experience.starting", "I'm just starting", "Choose 0 – 2 years."),
      answer("bp.experience.why", "Why do you ask?", "It helps us recommend the right bookings for you."),
    ],
  },
  vendorType: {
    name: "Vendor type",
    about: "the type of vendor you are and the services you provide",
    topics: [
      answer(
        "bp.vendorType.which",
        "Which type should I pick?",
        "Pick the one that matches your main service: Caterer, Decorator, DJ Artist, Make up Artist, Photography and Videography, or Venue Provider."
      ),
      answer("bp.vendorType.many", "I offer more than one service", "Pick your main service for now."),
    ],
  },
  eventsCovered: {
    name: "Events covered",
    about: "the events you cover for your vendor type",
    topics: [
      answer(
        "bp.events.howMany",
        "How many events can I pick?",
        "Select all the event types you can work. You can choose more than one."
      ),
      answer(
        "bp.events.missing",
        "I can't find my event",
        "Use Search Events to find it. If it isn't listed, choose Something else below."
      ),
    ],
  },
  serviceArea: {
    name: "Service area",
    about: "the areas you operate in",
    topics: [
      answer(
        "bp.area.choose",
        "How do I choose my area?",
        "Pick the areas you operate in, like Gurgaon or Noida. Then narrow down to localities if needed."
      ),
      answer("bp.area.wholeCity", "I serve the whole city", "Choose the entire city, like “Entire Gurgaon (all 21)”."),
      answer(
        "bp.area.missing",
        "I can't find my locality",
        "Tap “Couldn't find your localities” and tell us which one is missing."
      ),
      answer(
        "bp.area.more",
        "Can I add more areas?",
        "Yes. Pick more areas. The Continue button shows how many areas and localities you've picked."
      ),
    ],
  },
  brandDescription: {
    name: "Brand description",
    about: "the description of your brand",
    topics: [
      answer(
        "bp.brand.what",
        "What should I write?",
        "Highlight key details and what makes you stand out, to attract clients."
      ),
      answer("bp.brand.length", "Why 200 characters?", "A minimum of 200 characters is required, and the limit is 400."),
      answer("bp.brand.skip", "Can I skip this?", "Yes. Tap Skip and add it later from your profile."),
    ],
  },
  profilePicture: {
    name: "Profile picture",
    about: "your profile picture",
    topics: [
      answer(
        "bp.picture.what",
        "What picture should I upload?",
        "Use a clear photo or your logo. Customers see it on your profile."
      ),
      answer("bp.picture.fit", "How do I fit my picture?", "Use Zoom to fit it in the frame, then tap Continue."),
      answer("bp.picture.failing", "Upload isn't working", "Check your connection and try again with a smaller image."),
    ],
  },
};

export const PROFILE_FIELDS = Object.keys(FIELDS);

export const profileFieldName = (field) => FIELDS[field]?.name ?? "Business profile";

export const businessProfileHelpFlowFor = (field) => {
  const { name, about, topics } = FIELDS[field] ?? FIELDS.businessName;
  return helpFlow({
    fallbackSummary: `on ${name}: ${about}.`,
    topics,
    endChat: END_CHAT,
    tutorial: TUTORIAL,
  });
};
