import { answer, END_CHAT, helpFlow } from "./helpTopics.js";

const TUTORIAL = { id: "personal-document", title: "Verifying your personal documents" };

const FIELDS = {
  aadhaar: {
    name: "Aadhaar number",
    about: "your Aadhaar number",
    topics: [
      answer(
        "doc.aadhaar.why",
        "Why do you need my Aadhaar number?",
        "To verify your identity. We send a 6-digit code (OTP) to confirm it."
      ),
      answer(
        "doc.aadhaar.whose",
        "Whose Aadhaar should I enter?",
        "The Aadhaar of the vendor who will provide the services. It can be different from the point of contact."
      ),
      answer(
        "doc.aadhaar.handy",
        "I don't have my Aadhaar handy",
        "Keep your Aadhaar card ready, then come back and finish from Home."
      ),
    ],
  },
  pan: {
    name: "PAN card",
    about: "your PAN card number",
    topics: [
      answer(
        "doc.pan.where",
        "Where do I find my PAN number?",
        "It's the 10-character number on your PAN card, like ABCDE1234F."
      ),
      answer(
        "doc.pan.invalid",
        "It says my PAN is invalid",
        "Check each character. A PAN has 5 letters, then 4 digits, then 1 letter."
      ),
      answer(
        "doc.pan.whose",
        "Whose PAN should I enter?",
        "The PAN of the vendor who will provide the services, not the point of contact."
      ),
    ],
  },
  gstin: {
    name: "GSTIN",
    about: "your GSTIN number",
    topics: [
      answer("doc.gstin.where", "Where do I find my GSTIN?", "It's on your GST registration certificate."),
      answer("doc.gstin.none", "I don't have a GSTIN", "Tap Skip and continue without it."),
      answer(
        "doc.gstin.details",
        "What are the Business Details?",
        "After you enter your GSTIN, we fetch your business name, PAN, business type and registered address. Check them, then tap Continue."
      ),
      answer(
        "doc.gstin.wrong",
        "The details look wrong",
        "Check that you entered the right GSTIN. If they are still wrong, choose Something else below and we'll help."
      ),
    ],
  },
  bankDetails: {
    name: "Bank details",
    about: "your bank details",
    topics: [
      answer(
        "doc.bank.whose",
        "Whose bank account can I add?",
        "The account must be in the name of the registered business or trade name as per your GSTIN."
      ),
      answer(
        "doc.bank.confirm",
        "Why do I confirm the account number?",
        "To avoid typing mistakes, because your payouts go to this account."
      ),
      answer(
        "doc.bank.ifsc",
        "Where do I find my IFSC code?",
        "It's printed on your cheque book or passbook. You can also tap Find IFSC Code to search for it."
      ),
    ],
  },
};

export const DOCUMENT_FIELDS = Object.keys(FIELDS);

export const documentFieldName = (field) => FIELDS[field]?.name ?? "Personal documents";

export const documentHelpFlowFor = (field) => {
  const { name, about, topics } = FIELDS[field] ?? FIELDS.aadhaar;
  return helpFlow({
    fallbackSummary: `on ${name}: ${about}.`,
    topics,
    endChat: END_CHAT,
    tutorial: TUTORIAL,
  });
};
