import {expect,it} from "vitest";
import {reviewInputSchema,safeDisplayName} from "@/modules/reviews/service";
it("review_rating_and_input_boundaries",()=>{
  const input={invitationId:"50000000-0000-4000-8000-000000000001",rating:1,text:"An honest critical review",locale:"en",displayName:"anonymous"};
  expect(reviewInputSchema.parse(input).rating).toBe(1);
  expect(()=>reviewInputSchema.parse({...input,rating:0})).toThrow();
  expect(()=>reviewInputSchema.parse({...input,rating:6})).toThrow();
  expect(()=>reviewInputSchema.parse({...input,primaryGuestId:"forged"})).toThrow();
});
it("review_display_name_does_not_expose_full_guest_identity",()=>{
  expect(safeDisplayName("Jane Sensitive Surname","initials")).toBe("J. S. S.");
  expect(safeDisplayName("Jane Sensitive Surname","first_name")).toBe("Jane");
  expect(safeDisplayName("Jane Sensitive Surname","anonymous")).toBe("Guest");
});
it("public reviews accept a moderated submission without a booking invitation",()=>{
  const input={source:"public",name:"Open Reviewer",rating:5,text:"A public review awaiting moderation",locale:"en",displayName:"first_name",consent:true,website:""};
  expect(reviewInputSchema.parse(input)).toMatchObject({source:"public",rating:5,consent:true});
  expect(()=>reviewInputSchema.parse({...input,invitationId:"50000000-0000-4000-8000-000000000001"})).toThrow();
});
