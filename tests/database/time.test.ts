import {beforeAll,afterAll,test,expect} from "vitest";
import {admin} from "./helpers";
import {cairoInstant} from "@/components/format";
const db=admin();beforeAll(()=>db.connect());afterAll(()=>db.end());
test("cairo_dst_scheduling",async()=>{
 for(const [local,utc] of [
  ["2026-04-23T09:00","2026-04-23T07:00:00.000Z"],
  ["2026-04-24T09:00","2026-04-24T06:00:00.000Z"],
  ["2026-10-29T09:00","2026-10-29T06:00:00.000Z"],
  ["2026-10-30T09:00","2026-10-30T07:00:00.000Z"],
 ]){
  expect(cairoInstant(local)).toBe(utc);
  const databaseTime=(await db.query("SELECT $1::timestamp AT TIME ZONE 'Africa/Cairo' AS instant",[local])).rows[0].instant;
  expect(databaseTime.toISOString()).toBe(utc);
 }
 expect(()=>cairoInstant("2026-04-24T00:30")).toThrow("does not exist");
});
