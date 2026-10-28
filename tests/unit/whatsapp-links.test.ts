import {describe,it,expect} from "vitest";
import {whatsappLink} from "@/modules/content/whatsapp";
describe("WhatsApp click to chat",()=>{
  it("preserves international digits and encodes an editable multilingual draft",()=>{
    const url=new URL(whatsappLink("+201099267451","Hello & مرحباً\nRSH-12")!);
    expect(url.origin+url.pathname).toBe("https://wa.me/201099267451");
    expect(url.searchParams.get("text")).toBe("Hello & مرحباً\nRSH-12");
    expect(whatsappLink("+201220907478")).toBe("https://wa.me/201220907478");
  });
  it.each([null,undefined,"","01099267451","+0201099267451","+20 1099267451","https://evil.test","+201099267451?text=bad","+1234567890123456"])("does not generate a link for malformed phone %s",phone=>{
    expect(whatsappLink(phone)).toBeNull();
  });
});
