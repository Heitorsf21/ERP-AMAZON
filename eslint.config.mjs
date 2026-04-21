import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  {
    rules: {
      // O projeto ainda usa efeitos para sincronizar estado de dialogs/filtros.
      // Mantemos essa regra desligada para não transformar upgrade de segurança
      // em refatoração comportamental ampla.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    ignores: [
      ".next/**",
      "build/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "out/**",
    ],
  },
];

export default eslintConfig;
