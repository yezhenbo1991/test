import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
    proxy: {
      "/projectinfo": {
        target: "http://127.0.0.1:8108/zrzy-ahlk",
        changeOrigin: true,
        secure: false,
      },
      "/queryresult": {
        target: "http://127.0.0.1:8108/zrzy-ahlk",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
