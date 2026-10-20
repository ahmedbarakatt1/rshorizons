import {describe,it,expect} from "vitest";
import {catalogFiltersSchema} from "../../src/modules/catalog/contracts";

describe("public catalog contracts",()=>{
  it("rejects invalid dates, unsupported locale and nonsensical guest count",()=>{
    for(const bad of [{locale:"xx"},{locale:"en",guests:"0"},{locale:"ar",date:"2026-02-30"},{locale:"de",guests:"9999"}]) {
      expect(catalogFiltersSchema.safeParse(bad).success).toBe(false);
    }
  });
  it("accepts bounded documented search filters",()=>{
    expect(catalogFiltersSchema.parse({locale:"nl",guests:"3",destination:"port-ghalib",category:"diving"})).toMatchObject({locale:"nl",guests:3});
  });
});
