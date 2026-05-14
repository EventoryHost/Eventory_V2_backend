import CatererPackage from "../models/CatererPackage.js";
import DecoratorPackage from "../models/DecoratorPackage.js";
import PAVPackage from "../models/PAVPackage.js";
import DJArtistPackage from "../models/DJArtistPackage.js";
import MakeupArtistPackage from "../models/MakeupArtistPackage.js";
import VenueProviderPackage from "../models/VenueProviderPackage.js";
import Package from "../models/Package.js";

const MODEL_MAP = {
  Caterer: CatererPackage,
  Decorator: DecoratorPackage,
  PAV: PAVPackage,
  DJArtist: DJArtistPackage,
  MakeupArtist: MakeupArtistPackage,
  VenueProvider: VenueProviderPackage,
};

export const getModelForVendor = (vendorType) => MODEL_MAP[vendorType] || Package;
export const SUPPORTED_TYPES = Object.keys(MODEL_MAP);
