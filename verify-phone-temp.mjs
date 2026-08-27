import("dotenv/config").then(async () => {
  const mongoose = (await import("mongoose")).default;
  const Customer = (await import("./src/models/Customer.js")).default;
  await mongoose.connect(process.env.MONGO_URI);
  await Customer.updateOne({ email: process.argv[2] }, { $set: { phone: "+919876500077", isPhoneVerified: true } });
  console.log("phone simulated verified for", process.argv[2]);
  await mongoose.disconnect();
});
