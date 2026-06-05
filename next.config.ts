import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Increase proxy/middleware body buffering limit for PDF uploads (default ~10MB)
    proxyClientMaxBodySize: "25mb",
  },
  async headers() {
    return [
      {
        source: "/embed/:path*",
        headers: [
          // X-Frame-Options: ALLOW-FROM is obsolete and accepts only ONE origin,
          // so we rely solely on CSP frame-ancestors (which supports multiple) to
          // control who may iframe the embeds. The HDR admin portal frames the
          // HDR inquiries CRM; the RentalWorks dashboard frames the rebates embed.
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://rentalworks-dashboard.vercel.app https://hdrsiteservices.com https://www.hdrsiteservices.com https://*.vercel.app",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
