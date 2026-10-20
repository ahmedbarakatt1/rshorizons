import {describe, expect, it} from "vitest";
import {assertOrigin, digestSecret, newSecret, safeEqual, redact} from "../../src/server/security";
import {quoteInputSchema, bookingInputSchema} from "../../src/modules/bookings/contracts";

describe("request boundaries", () => {
  it("cross_origin_cookie_mutation_is_denied", () => {
    expect(()=>assertOrigin(new Request("https://agency.example/api/v1/bookings",{method:"POST",headers:{origin:"https://attacker.example"}}),"https://agency.example")).toThrow(/ORIGIN/);
    expect(()=>assertOrigin(new Request("https://agency.example/api/v1/bookings",{method:"POST"}),"https://agency.example")).toThrow(/ORIGIN/);
    expect(()=>assertOrigin(new Request("https://agency.example/api/v1/bookings",{method:"POST",headers:{origin:"https://agency.example"}}),"https://agency.example")).not.toThrow();
  });
  it("access_secrets_have_256_bits_and_only_peppered_digest_is_stored", () => {
    const raw = newSecret();
    expect(Buffer.from(raw,"base64url")).toHaveLength(32);
    expect(digestSecret(raw,"first")).not.toEqual(digestSecret(raw,"second"));
    expect(digestSecret(raw,"first")).not.toContain(raw);
  });
  it("signature_comparison_rejects_different_lengths", () => {
    expect(safeEqual("a","aa")).toBe(false);
    expect(safeEqual("signed","signed")).toBe(true);
  });
  it("redacted_diagnostics_remove_nested_secrets_contacts_and_payloads", () => {
    expect(redact({token:"sensitive",status:"failed",nested:{email:"private@example.com",authorization:"secret"}})).toEqual({token:"[REDACTED]",status:"failed",nested:{email:"[REDACTED]",authorization:"[REDACTED]"}});
  });
});

describe("validated contracts", () => {
  const tour = {kind:"tour",variantId:"11111111-1111-4111-8111-111111111111",departureId:"22222222-2222-4222-8222-222222222222",adults:2,children:0};
  it("tampered_price_fields_rejected", () => {
    expect(quoteInputSchema.safeParse({locale:"en",paymentPolicy:"full",items:[{...tour,total:1}]}).success).toBe(false);
  });
  it("dates_require_real_calendar_days_and_half_open_positive_stay", () => {
    const base={locale:"en",paymentPolicy:"deposit",items:[{kind:"stay",apartmentId:tour.variantId,checkIn:"2027-02-29",checkOut:"2027-03-02",guests:2}]};
    expect(quoteInputSchema.safeParse(base).success).toBe(false);
    expect(quoteInputSchema.safeParse({...base,items:[{...base.items[0],checkIn:"2027-03-02"}]}).success).toBe(false);
  });
  it("transfer_requires_explicit_offset_and_passenger_capacity_inputs", () => {
    expect(quoteInputSchema.safeParse({locale:"ar",paymentPolicy:"arrival",items:[{kind:"transfer",variantId:tour.variantId,pickupAt:"2027-04-01T10:00:00",pickup:"Hotel",dropoff:"Airport",passengers:2,luggage:2}]}).success).toBe(false);
  });
  it("guest_checkout_does_not_require_an_account_but_requires_usable_contact_and_policies", () => {
    const input={quoteId:tour.variantId,guest:{fullName:"Example Guest",email:"guest@example.com",locale:"de"},participants:[{displayName:"Example Guest",ageCategory:"adult"}],consents:{termsAccepted:true,termsVersion:"demo-v1",privacyNoticeVersion:"demo-v1",whatsappBookingUpdates:false,marketing:false,publicMediaUse:false}};
    expect(bookingInputSchema.safeParse(input).success).toBe(true);
    expect(bookingInputSchema.safeParse({...input,guest:{fullName:"Guest",locale:"de"}}).success).toBe(false);
    expect(bookingInputSchema.safeParse({...input,actorId:tour.variantId}).success).toBe(false);
  });
});
