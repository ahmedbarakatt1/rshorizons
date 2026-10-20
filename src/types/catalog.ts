export type DestinationSummary = {id:string;slug:string;title:string;summary:string;image:string};
export type ServiceSummary = {
  id:string;slug:string;title:string;summary:string;category:string;
  destination:string;destinationSlug:string;image:string;fromAmountMinor:string;
  currency:string;durationMinutes:number;paymentPolicies:string[];
};
export type ServiceDetail = ServiceSummary & {
  variants:{id:string;title:string;priceAmountMinor:string;currency:string;pricingUnit:string;capacityModel:string}[];
  departures:{id:string;startsAt:string;endsAt:string;availableSeats:number;variantId:string}[];
  itinerary:string[];inclusions:string[];exclusions:string[];
  restrictions:Record<string,unknown>;meetingNotes:string;
  addons:{variantId:string;title:string;minQuantity:number;maxQuantity:number}[];
  pickupOptions:{id:string;variantId:string;title:string;address:string;surchargeAmountMinor:string;currency:string}[];
};
export type ApartmentSummary = {
  id:string;slug:string;title:string;summary:string;unitCode:string;maxGuests:number;
  bedrooms:number;beds:number;bathrooms:number;nightlyAmountMinor:string;
  cleaningFeeMinor:string;currency:string;image:string;amenities:string[];
};
export type ApartmentDetail = ApartmentSummary & {
  houseRules:string[];checkInTime:string;checkOutTime:string;minNights:number;paymentPolicies:string[];
};
export type CatalogData = {services:ServiceSummary[];apartments:ApartmentSummary[];destinations:DestinationSummary[];demo:boolean};
