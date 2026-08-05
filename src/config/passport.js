import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { findOrCreateSocialCustomer } from "../controllers/customerSocialAuthController.js";

/**
 * Registers the Google/Facebook OAuth strategies ONLY if their credentials
 * are present in .env. This lets the app boot and every other route work
 * normally even before real OAuth app credentials exist — the /google and
 * /facebook routes just respond 501 (see customerSocialAuthController.js)
 * instead of the process crashing on an unconfigured Passport strategy.
 *
 * No sessions are used anywhere (session: false on every authenticate()
 * call) — this app is 100% stateless JWT/refresh-token auth, so there's no
 * serializeUser/deserializeUser to configure.
 */

export const isGoogleConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL
);

export const isFacebookConfigured = Boolean(
  process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET && process.env.FACEBOOK_CALLBACK_URL
);

if (isGoogleConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const customer = await findOrCreateSocialCustomer(
            {
              email: profile.emails?.[0]?.value || null,
              name: profile.displayName,
              photo: profile.photos?.[0]?.value || null,
              providerId: profile.id,
            },
            "google"
          );
          done(null, customer);
        } catch (err) {
          done(err);
        }
      }
    )
  );
} else {
  console.warn(
    "[passport] Google OAuth not configured (missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_CALLBACK_URL) — " +
      "GET /api/customer/auth/google will respond 501 until these are set in .env."
  );
}

if (isFacebookConfigured) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: process.env.FACEBOOK_CALLBACK_URL,
        profileFields: ["id", "displayName", "emails", "photos"],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const customer = await findOrCreateSocialCustomer(
            {
              email: profile.emails?.[0]?.value || null,
              name: profile.displayName,
              photo: profile.photos?.[0]?.value || null,
              providerId: profile.id,
            },
            "facebook"
          );
          done(null, customer);
        } catch (err) {
          done(err);
        }
      }
    )
  );
} else {
  console.warn(
    "[passport] Facebook OAuth not configured (missing FACEBOOK_APP_ID/FACEBOOK_APP_SECRET/FACEBOOK_CALLBACK_URL) — " +
      "GET /api/customer/auth/facebook will respond 501 until these are set in .env."
  );
}

export default passport;
