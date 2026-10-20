import type {MetadataRoute} from "next";
export default function robots():MetadataRoute.Robots {
 return {rules:{userAgent:"*",...(process.env.APP_ENV!=="production"||process.env.BUSINESS_CONTENT_APPROVED!=="true"?{disallow:"/"}:{allow:"/",disallow:["/admin/","/api/","/*/booking/","/*/guest-access","/*/my-gallery","/*/my-booking"]})},...(process.env.APP_BASE_URL?{sitemap:`${process.env.APP_BASE_URL}/sitemap.xml`}:{})};
}
