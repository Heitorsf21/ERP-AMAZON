/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // Source maps off em dev: reduz uso de RAM em Windows (~30-40%).
  productionBrowserSourceMaps: false,
  experimental: {
    // Limita o número de workers paralelos (evita PostCSS workers órfãos no Windows).
    cpus: 2,
  },
  // Declara Turbopack explicitamente (Next.js 16 default). O webpack config
  // acima é só dev (watchOptions) — não afeta builds de prod.
  turbopack: {},
  webpack: (config, { dev }) => {
    if (dev) {
      // Excluir diretórios pesados do file watcher (Windows é especialmente
      // vulnerável a watch loops em pastas grandes).
      config.watchOptions = {
        ...(config.watchOptions ?? {}),
        ignored: [
          "**/node_modules/**",
          "**/.next/**",
          "**/uploads/**",
          "**/.git/**",
          "**/.dev-server.log",
          "**/prisma/dev.db*",
        ],
      };
      // Desligar cache em disco do webpack (evita .next/ crescer pra GBs).
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
