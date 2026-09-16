import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();
await mongoose.connect(process.env.MONGO_URI);
const Package = mongoose.connection.collection("packages");
const live = await Package.find({ packageStatus: "Live", "step2_productsAndPricing.addOns.0": { $exists: true } })
  .project({ "step1_eventAndCrew.packageName": 1, vendorType: 1, "step2_productsAndPricing.addOns": 1 })
  .toArray();
console.log("Live packages with addOns:", live.length);
let total = 0;
for (const p of live) {
  for (const a of p.step2_productsAndPricing.addOns) {
    total++;
    console.log(`\n[${p.vendorType}] ${p.step1_eventAndCrew?.packageName} -> addon "${a.name}"`);
    console.log("  materialOptions:", JSON.stringify(a.materialOptions));
    console.log("  physicalSpec:", JSON.stringify(a.physicalSpec));
    console.log("  policyDocUrl:", JSON.stringify(a.policyDocUrl));
    console.log("  policy:", JSON.stringify(a.policy));
  }
}
console.log("\ntotal addons:", total);
await mongoose.disconnect();
