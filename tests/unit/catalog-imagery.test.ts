import {describe,expect,it} from "vitest";
import {illustrativeImage,resolveIllustrativeImage} from "@/components/catalog-imagery";

describe("illustrative catalog imagery",()=>{
 it("replaces the legacy scenery and apartment placeholders with distinct local images",()=>{
  expect(resolveIllustrativeImage("/images/desert.svg")?.src).toContain("/desert-v1-960.webp");
  expect(resolveIllustrativeImage("/images/coast.svg")?.src).toContain("/coast-v1-960.webp");
  expect(resolveIllustrativeImage("/images/apartment.svg")?.src).toContain("/apartment-v1-960.webp");
  expect(illustrativeImage("buggy")).not.toBe(illustrativeImage("desert"));
  expect(illustrativeImage("boat")).not.toBe(illustrativeImage("transfer"));
 });
 it("provides responsive local candidates only for known illustrative assets",()=>{
  const result=resolveIllustrativeImage(illustrativeImage("apartment"));
  expect(result?.srcSet).toContain("apartment-v1-480.webp 480w");
  expect(result?.srcSet).toContain("apartment-v1-1440.webp 1440w");
  expect(result?.avifSrcSet).toContain("apartment-v1-960.avif 960w");
  expect(resolveIllustrativeImage("/images/editorial/unknown.webp")).toBeUndefined();
 });
 it("leaves owner trip photographs and approved public media unchanged",()=>{
  for(const source of ["hero","diving","reef","surface-swim","/api/v1/demo-media/open-water","/api/v1/public-media/approved-asset"]){
   expect(resolveIllustrativeImage(source)).toBeUndefined();
  }
 });
});
