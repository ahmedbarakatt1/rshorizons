import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
const spec=JSON.parse(readFileSync("docs/openapi.json","utf8"));
type Shape={type?:string;properties?:Record<string,Shape>;$ref?:string;anyOf?:Shape[];oneOf?:Shape[]};
const resolve=(shape:Shape):Shape=>shape.$ref?spec.components.schemas[shape.$ref.split("/").at(-1)!]:shape;
describe("published API contracts",()=>{
 it("covers financial reconciliation, invitation, pickup, manifests and authenticated scheduled tasks",()=>{
  for(const [path,method] of [
   ["/api/v1/admin/refunds/{id}/execute","post"],["/api/v1/admin/refunds/{id}/reconcile","post"],
   ["/api/v1/admin/staff/invitations","post"],["/api/v1/admin/auth/invite-accept","post"],
   ["/api/v1/admin/bookings/{id}/manifest","get"],["/api/v1/admin/pickup-locations","get"],
   ["/api/v1/admin/stays","get"],["/api/v1/photo-packages","get"],
   ["/api/v1/webhooks/mux","post"],["/api/v1/webhooks/resend","post"],["/api/v1/webhooks/whatsapp","post"],
   ["/api/internal/worker","get"],["/api/internal/retention","get"],["/api/internal/monitor","get"],
  ])expect(spec.paths[path]?.[method],`${method} ${path}`).toBeDefined();
 });
 it("describes request fields instead of accepting empty object placeholders",()=>{
  for(const [path,methods] of Object.entries(spec.paths))for(const [method,value] of Object.entries(methods as Record<string,{requestBody?:{content?:Record<string,{schema:Shape}>}}>)){
   const schema=value.requestBody?.content?.["application/json"]?.schema;
   if(!schema)continue;
   const actual=resolve(schema);
   expect(!!actual.properties&&Object.keys(actual.properties).length>0||!!actual.anyOf||!!actual.oneOf,`${method} ${path}`).toBe(true);
  }
 });
 it("distinguishes asynchronous acknowledgement, binary upload and raw signed callbacks",()=>{
  for(const path of ["/api/v1/contact","/api/v1/guest-access/request"])expect(spec.paths[path].post.responses["202"]).toBeDefined();
  expect(spec.paths["/api/v1/admin/media/{id}/bytes"].put.requestBody.content["application/octet-stream"]).toBeDefined();
  expect(spec.paths["/api/v1/galleries/{id}/assets/{derivativeId}"].get.responses["200"].content["application/octet-stream"]).toBeDefined();
  expect(spec.paths["/api/v1/webhooks/resend"].post.parameters.map((p:{name:string})=>p.name)).toEqual(expect.arrayContaining(["svix-id","svix-timestamp","svix-signature"]));
 });
});
