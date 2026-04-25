// PM2 ecosystem para a VPS Hostinger.
// Use:
//   pm2 start deploy/ecosystem.config.js
//   pm2 save
//
// Dois processos:
//  - erp-web    : Next.js (next start) na porta 3000
//  - erp-worker : daemon que processa AmazonSyncJob em loop
module.exports = {
  apps: [
    {
      name: "erp-web",
      cwd: "/opt/erp-amazon",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "700M",
      env: {
        NODE_ENV: "production",
      },
      time: true,
    },
    {
      name: "erp-worker",
      cwd: "/opt/erp-amazon",
      script: "node_modules/.bin/tsx",
      args: "scripts/amazon-worker.ts",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
      time: true,
    },
  ],
};
