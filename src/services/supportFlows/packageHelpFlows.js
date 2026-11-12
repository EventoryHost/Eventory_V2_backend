import { answer, branch, helpFlow } from "./helpTopics.js";

const DECORATOR_VENDOR_TYPE = "Decorator";

const step1 = helpFlow({
  fallbackSummary: "This is where you name the package and set events, duration and team.",
  topics: [
    answer(
      "s1.name",
      "How should I name my package?",
      "Lead with style, setup and occasion, like “Pastel Floral Mandap for Weddings”. Keep it under 50 characters.",
    ),
    answer(
      "s1.eventType",
      "My event type isn't listed",
      "Type it in “Enter Performance type” and press enter. It's added as a custom event type for this package.",
    ),
    branch("s1.duration", "Event duration", "Which part is unclear?", [
      answer(
        "s1.duration.minMax",
        "Min vs max duration",
        "Min is the shortest booking you'll accept and Max is the longest. Customers pick hours between the two.",
      ),
      answer(
        "s1.duration.setup",
        "Does it include setup time?",
        "No. Duration is the hours your team stays at the event. Setup time goes under Team and Setup.",
      ),
    ]),
    branch("s1.team", "Team and Setup", "Which field do you need help with?", [
      answer(
        "s1.team.poc",
        "Point of Contact",
        "Pick someone who answers calls on the event day. Customers and your Event Manager will reach them.",
      ),
      answer(
        "s1.team.setupDuration",
        "Setup duration",
        "How long your team needs on site before the event starts, like “Upto 1 hour”.",
      ),
      answer("s1.team.size", "Number of people in team", "Count everyone who comes on the day, including helpers."),
    ]),
    answer(
      "s1.variant",
      "What does Premium mean here?",
      "It's the variant you're editing. Each variant (Premium, Standard, Basic) has its own details and price. Switch from the menu at the top.",
    ),
  ],
});

const step2Decorator = helpFlow({
  fallbackSummary: "This is where you add setups, add-ons and their prices.",
  topics: [
    branch("s2.addSetup", "How do I add a setup?", "How do you want to start?", [
      answer(
        "s2.addSetup.preset",
        "Start from a preset",
        "In Add a Setup, pick a style like Floral Arch and tap Proceed with this Setup. You'll add its items next.",
      ),
      answer(
        "s2.addSetup.photo",
        "Use my own photo",
        "Upload a reference photo. We suggest items from it. Check each one and set the setup cost.",
      ),
    ]),
    answer(
      "s2.setupVsAddon",
      "Setup or add-on, which is which?",
      "A setup is a decorated area, like a floral arch. An add-on is an optional extra the customer chooses, priced separately.",
    ),
    branch("s2.items", "Adding items to a setup", "What do you need?", [
      answer(
        "s2.items.typePrice",
        "Item type and price",
        "Choose a type (Flowers, Lighting, Furniture…), then enter quantity and total price.",
      ),
      answer(
        "s2.items.colours",
        "Colour options",
        "Tap Add Color for each colour customers can pick. Turn on “Charge more for larger size” if bigger sizes cost extra.",
      ),
    ]),
    answer(
      "s2.total",
      "How is the total price calculated?",
      "It's the sum of your setups' item prices. You can edit the total to override it.",
    ),
    branch("s2.teardown", "Tear-down and what's not included", "Which one?", [
      answer(
        "s2.teardown.required",
        "Tear-down required?",
        "Choose Yes if your team must dismantle after the event.",
      ),
      answer(
        "s2.teardown.notIncluded",
        "What's not included",
        "Tell customers what they must arrange themselves, like power points or permits. It avoids disputes later.",
      ),
    ]),
  ],
});

const step2Generic = helpFlow({
  fallbackSummary: "This is where you add the items in this package.",
  topics: [],
});

const step3 = helpFlow({
  fallbackSummary: "This is where you set your price, GST, dynamic pricing and policies.",
  topics: [
    branch("s3.gst", "GST and tax", "What do you need?", [
      answer(
        "s3.gst.included",
        "Is GST included in my price?",
        "Choose Yes if the prices you entered already include GST. Otherwise choose No and enter your GST percentage.",
      ),
      answer("s3.gst.rate", "Which percentage do I enter?", "Use the rate on your GST registration."),
    ]),
    branch("s3.dynamic", "How does dynamic pricing work?", "Which rule?", [
      answer("s3.dynamic.weekends", "Weekends", "Set a different price for weekend dates."),
      answer("s3.dynamic.season", "Wedding season", "Set a price for peak wedding months."),
      answer("s3.dynamic.festivals", "Festivals", "Adjust your price around festival dates."),
      answer("s3.dynamic.custom", "Custom dates", "Pick exact dates and set a price for them."),
    ]),
    branch("s3.policies", "Policies and documents", "Which one?", [
      answer(
        "s3.policies.cancellation",
        "Cancellation Policy",
        "Pick one you can honour. Tap Update to change it any time.",
      ),
      answer(
        "s3.policies.lastMinute",
        "Last Minute Charges",
        "Extra charges when a customer books or changes close to the event date.",
      ),
      answer(
        "s3.policies.general",
        "General Policy",
        "Any other rules customers must accept, like payment terms. Tap Add to write them.",
      ),
    ]),
    answer(
      "s3.pricePerPackage",
      "What is “Price per package”?",
      "It's what you charge for your team and equipment on this package. Enter it before choosing the GST option.",
    ),
  ],
});

const step4 = helpFlow({
  fallbackSummary: "This is where you upload sample photos and videos.",
  topics: [
    answer(
      "s4.uploadFailing",
      "My upload keeps failing",
      "Each file can be up to 50 MB. Try Wi-Fi, or compress large videos before uploading.",
    ),
    answer("s4.formats", "Which formats can I upload?", "Images and videos, up to 50 MB each."),
    answer(
      "s4.howMany",
      "How many photos should I add?",
      "At least 5 high-quality photos and 1–2 short videos help customers trust your work.",
    ),
    answer(
      "s4.removeReplace",
      "Remove or replace a file",
      "Tap the cross next to a file to remove it, then add a new one with Tap to Upload media.",
    ),
    answer(
      "s4.afterSave",
      "What happens after I save?",
      "Step 4 is marked done on the Create a Package screen. When all 4 steps are done, tap Submit for Review.",
    ),
  ],
});

export function packageHelpFlowFor({ step, vendorType }) {
  switch (step) {
    case 1:
      return step1;
    case 2:
      return vendorType === DECORATOR_VENDOR_TYPE ? step2Decorator : step2Generic;
    case 3:
      return step3;
    case 4:
      return step4;
    default:
      return helpFlow({ fallbackSummary: "", topics: [] });
  }
}
