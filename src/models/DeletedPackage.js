import mongoose from "mongoose";

const DeletedPackageSchema = new mongoose.Schema(
  {
    archivedAt: { type: Date, required: true },
  },
  { strict: false, versionKey: false, collection: "deleted_packages" }
);

DeletedPackageSchema.index({ vendorId: 1, archivedAt: -1 });
DeletedPackageSchema.index({ packageGroupId: 1 });

const DeletedPackage = mongoose.model("DeletedPackage", DeletedPackageSchema);

export default DeletedPackage;
