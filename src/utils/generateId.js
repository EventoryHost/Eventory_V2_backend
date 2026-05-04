import crypto from "crypto";

const generateUniqueId = (type) => {
  const now = new Date();

  // Convert to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000; // IST offset in milliseconds
  const istTime = new Date(now.getTime() + istOffset);

  const { day, month, year, hours, minutes, seconds, milliseconds } = {
    day: istTime.getUTCDate().toString().padStart(2, "0"),
    month: (istTime.getUTCMonth() + 1).toString().padStart(2, "0"),
    year: istTime.getUTCFullYear().toString().padStart(4, "0"),
    hours: istTime.getUTCHours().toString().padStart(2, "0"),
    minutes: istTime.getUTCMinutes().toString().padStart(2, "0"),
    seconds: istTime.getUTCSeconds().toString().padStart(2, "0"),
    milliseconds: istTime.getUTCMilliseconds().toString().padStart(3, "0"),
  };

  // Add random suffix to prevent collisions when multiple IDs generated in same millisecond
  const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase();

  return `${type}${day}${month}${year}${hours}${minutes}${seconds}${milliseconds}${randomSuffix}`;
};

// Export the main function as default and named export
// Usage: generateUniqueId("VEN"), generateUniqueId("CAT"), generateUniqueId("DEC"), etc.

// Payment ID generation (keeping existing function)
export function generatePaymentId() {
  const upperDigits = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const allChars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  const randomChars = (length, chars) => {
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  return "pay_" + randomChars(6, upperDigits) + randomChars(8, allChars);
}

// Signature generation (keeping existing function)
export function generateSignature(clientId, key, timestamp) {
  const publicKey = crypto.createPublicKey({
    key: key,
    format: "pem",
  });
  const data = `${clientId}.${timestamp}`;

  const encryptedData = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(data, "utf8"),
  );

  const signature = encryptedData.toString("base64");
  return signature;
}

export default generateUniqueId;
