import type {NextConfig} from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  distDir:process.env.NEXT_BUILD_DIR===".next-release"?".next-release":".next",
  outputFileTracingExcludes:{"/*":["./.local/**/*","./.tooling/**/*","./.agents/**/*","./media/**/*","./.env*","./docs/**/*","./tests/**/*"]},
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["pg"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        {key:"X-Content-Type-Options", value:"nosniff"},
        {key:"Referrer-Policy", value:"strict-origin-when-cross-origin"},
        {key:"X-Frame-Options", value:"DENY"},
        {key:"Permissions-Policy", value:"camera=(), microphone=(), geolocation=()"},
        ...(process.env.APP_ENV==="production"||process.env.APP_ENV==="staging"?[{key:"Strict-Transport-Security",value:"max-age=31536000"}]:[])
      ]
    }, {
      source:"/api/v1/:path*",
      headers:[{key:"Cache-Control",value:"private, no-store"},{key:"X-Robots-Tag",value:"noindex, nofollow"}]
    }, {
      source:"/admin/:path*",
      headers:[{key:"Cache-Control",value:"private, no-store"},{key:"X-Robots-Tag",value:"noindex, nofollow"}]
    }];
  }
};
export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
