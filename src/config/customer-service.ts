// Owner-selected flow: bookings and payment arrangements are completed by customer service.
export const websiteCheckoutEnabled = false;
export const automatedEmailEnabled = false;
export const businessEmail = "horizonsredsea@gmail.com";
// Populate only with owner-confirmed public payment instructions and page URLs.
export const paymentInstructions: {bankName:string;accountName:string;accountNumber:string;iban:string;instapay:string;instapayUrl:string;walletNumber:string} = {
  bankName:"",accountName:"",accountNumber:"",iban:"",instapay:"abdohassan8123@instapay",instapayUrl:"https://ipn.eg/S/abdohassan8123/instapay/8Yhxaj",walletNumber:"01201338200"
};
export const socialPages: {platform:string;url:string}[] = [
  {platform:"Instagram",url:"https://www.instagram.com/horizonsrs2026/"},
  {platform:"TikTok",url:"https://www.tiktok.com/@red.sea.horizons"}
];
