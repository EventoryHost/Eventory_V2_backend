import { z } from "zod";

const emId = z.string().trim().min(1).max(64);
const title = z.string().trim().min(1).max(80);
const text = z.string().trim().min(1).max(2000);

/** GET /api/admin/em-reply-templates?emId= — one Event Manager's templates. */
export const emTemplateListSchema = z.object({ emId });

/** DELETE / use: the template must belong to this Event Manager. */
export const emTemplateOwnerSchema = z.object({ emId });

export const emTemplateCreateSchema = z.object({
  emId,
  emName: z.string().trim().max(60).optional(),
  title,
  text,
});

export const emTemplateUpdateSchema = z
  .object({ emId, title: title.optional(), text: text.optional() })
  .refine((b) => b.title != null || b.text != null, { message: "Nothing to update", path: ["title"] });
