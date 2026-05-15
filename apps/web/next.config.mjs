/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false;
    }

    return config;
  }
};

export default nextConfig;
