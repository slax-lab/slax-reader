import { WorkerEntrypoint } from "cloudflare:workers";
export class ContentEntry extends WorkerEntrypoint {
  async fetch(request) {
    const url = new URL(typeof request === "string" ? request : request.url);
    const code = url.searchParams.get("collect_code");
    if (code === "Missing123") return new Response("missing", { status: 404 });
    if (code === "Failed123") return new Response("failed", { status: 502 });
    return Response.json({
      status: code === "Closed123" ? 0 : 1,
      list: [],
      bookmark_count: 0,
      subscrition_count: 0,
      collection_name: "Analytics fixture",
      publisher_name: "Fixture",
      is_owner: false,
    });
  }
  async trackEvent() {
    return { ok: true };
  }
}
export default {
  fetch() {
    return new Response("local collection fixture");
  },
};
