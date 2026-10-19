import { createApp } from "vue";
import { createPinia } from "pinia";
import { createI18n } from "vue-i18n";
import App from "./App.vue";
import en from "./locales/en";
import zh from "./locales/zh";
import "./styles/app.css";
const i18n = createI18n({
  legacy: false,
  locale: navigator.language.startsWith("zh") ? "zh" : "en",
  fallbackLocale: "en",
  messages: { en, zh },
});
createApp(App).use(createPinia()).use(i18n).mount("#app");
