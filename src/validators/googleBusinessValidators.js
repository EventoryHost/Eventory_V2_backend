import { z } from "zod";

const sessionToken = z.string().trim().max(100).optional();

export const googleBusinessSearchQuerySchema = z.object({
  q: z.string().trim().min(2, "Type at least 2 characters").max(120),
  sessionToken,
});

export const googleBusinessPlaceQuerySchema = z.object({ sessionToken });

export const googleBusinessLinkSchema = z.object({
  placeId: z.string().trim().min(1, "placeId is required").max(300),
  sessionToken,
});

export const googleBusinessResolveLinkSchema = z.object({
  url: z.string().trim().min(1, "url is required").max(2000),
});
