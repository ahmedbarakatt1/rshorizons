import {z} from "zod";
import {dateSchema,localeSchema} from "../bookings/contracts";
export const catalogFiltersSchema=z.object({
  locale:localeSchema.default("en"),guests:z.coerce.number().int().min(1).max(100).optional(),
  destination:z.string().max(100).optional(),category:z.string().max(100).optional(),
  date:dateSchema.optional(),cursor:z.string().max(200).optional()
}).strict();
