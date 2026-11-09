/** Static export: no server code exists, so business data has nowhere to go. */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  images: { unoptimized: true },
  trailingSlash: true,
};
export default nextConfig;
