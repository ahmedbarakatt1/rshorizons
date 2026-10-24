import {expect,test} from "vitest";
import {bookingInputSchema} from "@/modules/bookings/contracts";
const input={quoteId:"557e6cff-cda0-41d1-aa89-53e341a777d6",guest:{fullName:"Synthetic guest",email:"guest@example.invalid",locale:"en"},participants:[{displayName:"Synthetic guest",ageCategory:"adult"}],consents:{termsAccepted:true,termsVersion:"test",privacyNoticeVersion:"test",whatsappBookingUpdates:true,marketing:false,publicMediaUse:false}};
test("WhatsApp updates require a usable phone number alongside consent",()=>{
  const missing=bookingInputSchema.safeParse(input);
  expect(missing.success).toBe(false);
  if(!missing.success)expect(missing.error.issues.some(issue=>issue.path.join(".")==="guest.phoneE164")).toBe(true);
  expect(bookingInputSchema.safeParse({...input,guest:{...input.guest,phoneE164:"+201234567890"}}).success).toBe(true);
  expect(bookingInputSchema.safeParse({...input,consents:{...input.consents,whatsappBookingUpdates:false}}).success).toBe(true);
});
