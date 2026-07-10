import mongoose from "mongoose";

const djArtistStep2Schema = new mongoose.Schema({
  items: [
    {
      name: { type: String },
      performanceType: { type: String },
      contentDetails: {
        genreOfMusic: [{ type: String }],
        language: [{ type: String }],
        description: { type: String },
      },
    },
  ],
  playlists: [
    {
      name: { type: String },
      type: {
        type: String,
        enum: ["Curated", "Custom", "Upload"],
      },
      playlistType: {
        type: String,
        enum: ["Type 1", "Type 2", "Type 3"],
      },
      songs: [
        {
          name: { type: String },
          artist: { type: String },
          duration: { type: String },
          url: { type: String },
        },
      ],
      customerPlaylistAllowed: { type: Boolean, default: false },
      guestRequestsAllowed: { type: Boolean, default: false },
    },
  ],
  equipments: [
    {
      name: { type: String },
      quantity: { type: Number },
      category: { type: String },
      subCategory: { type: String },
    },
  ],
  hasBackupEquipment: { type: Boolean, default: false },
  addOns: [
    {
      addOnType: { type: String, enum: ["Service", "Product"] },
      name: { type: String },
      category: { type: String },
      subCategory: { type: String },
      quantity: { type: Number },
      description: { type: String },
      price: { type: Number },
      billingUnit: { type: String },
      policyDocUrl: { type: String },
      mediaUrls: [{ type: String }],
    },
  ],
  included: [{ type: String }],
  notIncluded: [{ type: String }],
}, { _id: false });

export default djArtistStep2Schema;
