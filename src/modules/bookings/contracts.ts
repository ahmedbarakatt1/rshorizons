import {z} from "zod";

export const localeSchema=z.enum(["en","de","pl","fr","ru","uk","es","ar","it","nl"]);
export const uuidSchema=z.guid();
export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
  const date=new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
},"Invalid calendar date");
export const instantSchema=z.string().datetime({offset:true});
const addon=z.object({variantId:uuidSchema,quantity:z.number().int().min(1).max(100),packageId:uuidSchema.optional()}).strict();
const tour=z.object({
  kind:z.literal("tour"),variantId:uuidSchema,departureId:uuidSchema,
  adults:z.number().int().min(1).max(100),children:z.number().int().min(0).max(100).default(0),
  addons:z.array(addon).max(10).optional(),pickupId:uuidSchema.optional()
}).strict();
const stay=z.object({
  kind:z.literal("stay"),apartmentId:uuidSchema,checkIn:dateSchema,checkOut:dateSchema,
  guests:z.number().int().min(1).max(30)
}).strict().refine(value=>value.checkOut>value.checkIn,"Checkout must be after check-in");
const transfer=z.object({
  kind:z.literal("transfer"),variantId:uuidSchema,departureId:uuidSchema.optional(),pickupAt:instantSchema,
  pickup:z.string().trim().min(2).max(400),dropoff:z.string().trim().min(2).max(400),
  passengers:z.number().int().min(1).max(100),luggage:z.number().int().min(0).max(100),
  flightNumber:z.string().trim().max(20).optional(),requestedVehicleKind:z.enum(["car","van","minibus","bus"]).optional()
}).strict();
const photography=z.object({
  kind:z.literal("photography"),variantId:uuidSchema,requestedStart:instantSchema,
  participants:z.number().int().min(1).max(30),packageId:uuidSchema.optional()
}).strict();
export const quoteInputSchema=z.object({
  locale:localeSchema,paymentPolicy:z.enum(["full","deposit","arrival"]),
  items:z.array(z.discriminatedUnion("kind",[tour,stay,transfer,photography])).min(1).max(20)
}).strict();
export const participantSchema=z.object({
  displayName:z.string().trim().min(1).max(150),
  ageCategory:z.enum(["adult","child","infant"]),guardianRelation:z.string().max(100).optional()
}).strict();
export const bookingInputSchema=z.object({
  quoteId:uuidSchema,
  guest:z.object({
    fullName:z.string().trim().min(2).max(150),email:z.string().email().max(254).optional(),
    phoneE164:z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),locale:localeSchema,countryCode:z.string().regex(/^[A-Z]{2}$/).optional()
  }).strict().refine(value=>!!(value.email||value.phoneE164),"A usable contact channel is required"),
  participants:z.array(participantSchema).min(1).max(100),
  consents:z.object({
    termsAccepted:z.literal(true),termsVersion:z.string().min(1).max(80),privacyNoticeVersion:z.string().min(1).max(80),
    whatsappBookingUpdates:z.boolean(),marketing:z.boolean(),publicMediaUse:z.boolean()
  }).strict()
}).strict();
export type QuoteInput=z.infer<typeof quoteInputSchema>;
export type BookingInput=z.infer<typeof bookingInputSchema>;
