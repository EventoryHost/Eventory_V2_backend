import mongoose from "mongoose";

const pavStep2Schema = new mongoose.Schema({
  packageItems: [
    {
      itemType: {
        type: String,
        enum: ["Albums/Hardcopy", "Photography", "Videography", "Others"],
      },
      contentDetails: {
        categories: [String],
        style: String,
        quantity: String,
        description: String,
      },
      albumSpecific: {
        coverType: String,
        pageCount: Number,
        bindingType: String,
        pageFinish: String,
      },
      videoSpecific: {
        numberOfVideos: String,
        duration: String,
        resolution: String,
      },
      logisticsAndHandover: {
        deliveryFormat: String,
        deliveryMedium: String,
        deliveryTimeline: String,
        isVisitingIncluded: { type: Boolean, default: false },
      },
      price: Number,
    },
  ],
    addOns: [
      {
        addOnType: { type: String, enum: ["Service", "Product"] },
        name: { type: String },
        category: { type: String },
        subCategory: { type: String },
        quantity: { type: Number },
        contentType:{type:String},
        description: { type: String },
        durationEach:{type:Number},
        productSpecific: {
          pageCount: Number,
          noOfEditedPhotos: Number,
          coverType: String,
          color: String,
          pageFinish: String,
          bindingType: String,
          contentSpec: String,
          fileFormat: String,
          resolution: String,
          videoType: String,
          duration: String,
        },
        price: { type: Number },
        billingUnit: { type: String },
        policyDocUrl: { type: String },
        mediaUrls: [{ type: String }],
      },
    ],
  included: [{ type: String }],
  notIncluded: [{ type: String }],
}, { _id: false });

export default pavStep2Schema;
