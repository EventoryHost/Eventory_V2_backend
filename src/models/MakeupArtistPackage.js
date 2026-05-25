import mongoose from "mongoose";
import Package from "./Package.js";
import makeupArtistStep2Schema from "./schemas/makeupArtistStep2Schema.js";

const MakeupArtistPackage = Package.discriminator(
  "MakeupArtist",
  new mongoose.Schema({
    step2_productsAndPricing: makeupArtistStep2Schema,
  })
);

export default MakeupArtistPackage;
