import {expect,it} from "vitest";
import {socialPages} from "@/config/customer-service";

it("includes the owner-approved Facebook page",()=>{
 expect(socialPages).toContainEqual({platform:"Facebook",url:"https://www.facebook.com/share/1CFka6exsG/"});
});
