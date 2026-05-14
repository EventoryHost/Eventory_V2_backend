const VALIDATION_RULES = {
  // Base validations (all vendors)
  base: (pkg) => {
    const errors = [];
    if (!pkg.step1_eventAndCrew?.packageName) errors.push("Package name is required");
    if (!pkg.step1_eventAndCrew?.eventCategories?.length) errors.push("At least one event category required");
    return errors;
  },

  // Vendor-specific validations
  Caterer: (pkg) => {
    const errors = [];
    if (!pkg.step2_productsAndPricing?.menus?.length) errors.push("At least one menu is required");
    return errors;
  },
  Decorator: (pkg) => {
    const errors = [];
    if (!pkg.step2_productsAndPricing?.setups?.length) errors.push("At least one setup is required");
    return errors;
  },
  PAV: (pkg) => {
    const errors = [];
    if (!pkg.step2_productsAndPricing?.packageItems?.length) errors.push("At least one package item required");
    return errors;
  },
  DJArtist: (pkg) => {
    const errors = [];
    if (!pkg.step2_productsAndPricing?.items?.length) errors.push("At least one DJ item required");
    return errors;
  },
  MakeupArtist: (pkg) => {
    const errors = [];
    if (!pkg.step2_productsAndPricing?.items?.length) errors.push("At least one service item required");
    return errors;
  },
  VenueProvider: (pkg) => {
    const errors = [];
    if (!pkg.step2_productsAndPricing?.spaces?.length) errors.push("At least one space is required");
    return errors;
  },
};

export const validatePackageSubmission = (pkg) => {
  const baseErrors = VALIDATION_RULES.base(pkg);
  const vendorType = pkg.vendorType;
  const vendorErrors = VALIDATION_RULES[vendorType] ? VALIDATION_RULES[vendorType](pkg) : [];
  
  return [...baseErrors, ...vendorErrors];
};
