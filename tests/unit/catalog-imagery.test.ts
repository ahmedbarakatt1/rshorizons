import {describe,expect,it} from "vitest";
import {resolveWebPhoto,webPhoto} from "@/components/catalog-imagery";

describe("web-sourced catalog photography",()=>{
 it("keeps distinct local derivatives for each sourced subject",()=>{
  expect(webPhoto("buggy")).not.toBe(webPhoto("desert"));
  expect(webPhoto("luxor")).not.toBe(webPhoto("apartment"));
 });
 it("provides responsive local candidates only for known web photographs",()=>{
  const result=resolveWebPhoto(webPhoto("apartment"));
  expect(result?.srcSet).toContain("apartment-480.webp 480w");
  expect(result?.srcSet).toContain("apartment-1280.webp 1280w");
  expect(resolveWebPhoto("/images/web/unknown.webp")).toBeUndefined();
 });
 it("leaves owner trip photographs and approved public media unchanged",()=>{
  for(const source of ["hero","diving","reef","surface-swim","/api/v1/demo-media/open-water","/api/v1/public-media/approved-asset"]){
   expect(resolveWebPhoto(source)).toBeUndefined();
  }
 });
});
