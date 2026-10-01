import {
  abortMultipart,
  completeMultipart,
  createMultipart,
  createPresignedPut,
  deleteObject,
  isCommercialCsv,
  readCommercialCsv,
} from "../services/uploadService.js";

export const presignUpload = async (req, res, next) => {
  try {
    const data = await createPresignedPut(req.body);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const startMultipartUpload = async (req, res, next) => {
  try {
    const data = await createMultipart(req.body);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const finishMultipartUpload = async (req, res, next) => {
  try {
    const data = await completeMultipart(req.body);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const cancelMultipartUpload = async (req, res, next) => {
  try {
    await abortMultipart(req.body);
    res.status(200).json({ success: true, message: "Upload aborted" });
  } catch (error) {
    next(error);
  }
};

export const deleteUpload = async (req, res, next) => {
  try {
    await deleteObject(req.body);
    res.status(200).json({ success: true, message: "File removed" });
  } catch (error) {
    next(error);
  }
};

export const getCommercialCsv = async (req, res, next) => {
  const { fileName } = req.params;
  if (!isCommercialCsv(fileName)) {
    return res.status(404).json({ success: false, message: "Unknown dataset" });
  }
  try {
    const content = await readCommercialCsv(fileName);
    if (content === null) {
      return res.status(404).json({ success: false, message: "Dataset is empty" });
    }
    res.status(200).json({ success: true, data: { fileName, content } });
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ success: false, message: "Dataset not found" });
    }
    next(error);
  }
};
