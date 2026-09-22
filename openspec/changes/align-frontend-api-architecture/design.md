# Design

Web reads only non-secret API TOML metadata and projects the Edge service and OSS bucket into a generated local Web config under deploy/local_web/.generated. It never imports API deploy scripts or copies vars/secrets. An explicit BACKEND_SERVICE_NAME remains the highest priority override.

Frontend SLAX_ENV chooses .env, .env.dev, .env.preview, .env.beta, or .env.production. API SLAX_API_ENV and native env selection remain independent. Offline prepare, typecheck and build use safe public defaults; dev and SSR explain how to initialize the API config when metadata is absent.

Nuxt platform persistence uses state/v3 while Wrangler CLI persist-to uses state. Tracked wrangler config files are sources and are never rewritten by build hooks. ContentEntry service and the API OSS bucket are both retained because SSR reads them directly.

The contracts package remains the wire contract package. Frontend-only implementation models stay in frontend-types and are referenced explicitly where legacy UI semantics differ from API DTOs.
