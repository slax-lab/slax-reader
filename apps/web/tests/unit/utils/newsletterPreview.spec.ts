// @vitest-environment happy-dom
import { expect, test } from "vitest";
import {
  sanitizeNewsletterPreview,
  sanitizeRssPreview,
} from "../../../app/utils/rssPreview";

test("Newsletter preview retains raster CID data without relaxing RSS image transport", () => {
  const data = "data:image/png;base64,aGVsbG8=";
  const html = '<p>Before</p><img src="' + data + '"><p>After</p>';
  expect(sanitizeNewsletterPreview(html)).toContain(data);
  expect(sanitizeRssPreview(html)).not.toContain("<img");
});

test("Newsletter preview rejects active images and direct remote images while retaining signed proxy images", () => {
  const proxy = "https://image.example/static/image?m=rss&d=signature";
  const html =
    '<script>alert(1)</script><img onerror="alert(1)" src="data:image/svg+xml;base64,PHN2Zz4="><img src="https://example.com/raw.png"><img src="' +
    proxy +
    '">';
  const result = sanitizeNewsletterPreview(html);
  expect(result).not.toMatch(/script|onerror|svg\+xml|raw\.png/);
  expect(result).toContain("d=signature");
});
