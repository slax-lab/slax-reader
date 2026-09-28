import { afterEach, describe, expect, test, vi } from "vitest";
import { CrawlService } from "@/domain/crawl";
import { SocialMediaApi } from "@/infra/external/socialMedia";
import type { TweetArticleInfo, TweetInfo } from "@/const/twitterapi/struct";
import {
	createMockBookmarkRepo,
	createMockBucketClient,
	createMockCtx,
} from "@test/helpers/mockFactory";

const STATUS_URL = "https://x.com/isnail/status/2100956349601624464";
const ARTICLE_URL = "https://x.com/i/article/2100948109664866305";
const SHORT_URL = "https://t.co/article123";
const BODY =
	"这是完整文章的正文，应该出现在阅读器和下游文本中，而不是只有推文导语。";
const ARTICLE_HTML = `<html><head><title>完整文章</title></head><body><article><h1>完整文章</h1><p>${BODY}</p></article></body></html>`;

function wire(
	text = `文章导语 ${SHORT_URL}`,
	expandedUrl: string | null = ARTICLE_URL
) {
	const ctx = createMockCtx();
	const embed = vi
		.fn()
		.mockImplementation(async () => new Response(ARTICLE_HTML));
	ctx.env.SlaxTwitterFxembed = { fetch: embed };
	const bucket = createMockBucketClient();
	const repo = createMockBookmarkRepo();
	const service = Object.assign(Object.create(CrawlService.prototype), {
		bucketClient: bucket.factory,
		bookmarkRepo: repo,
	}) as CrawlService;
	const tweet = {
		id: "2100956349601624464",
		url: STATUS_URL,
		text,
		author: {
			name: "蜗牛",
			userName: "isnail",
			profilePicture: "",
			url: "https://x.com/isnail",
		},
		createdAt: "2026-06-03T00:00:00Z",
		quoted_tweet: null,
		entities:
			expandedUrl === null
				? undefined
				: {
						urls: [
							{
								url: SHORT_URL,
								expanded_url: expandedUrl,
								display_url: expandedUrl,
								indices: [],
							},
						],
				  },
	} as TweetInfo;
	const article = {
		id: "2100948109664866305",
		author: tweet.author,
		title: "完整文章",
		preview_text: "预览",
		cover_media_img_url: "",
		contents: [{ type: "unstyled", text: BODY }],
		createdAt: tweet.createdAt,
		replyCount: 0,
		likeCount: 0,
		quoteCount: 0,
		viewCount: 0,
	} as TweetArticleInfo;
	vi.spyOn(SocialMediaApi, "fetchTwitter").mockResolvedValue([tweet]);
	const api = vi
		.spyOn(SocialMediaApi, "fetchTwitterArticle")
		.mockResolvedValue(article);
	const resolve = vi
		.spyOn(service, "resolveShortLink")
		.mockResolvedValue(ARTICLE_URL);
	return {
		service,
		ctx,
		tweet,
		article,
		embed,
		api,
		resolve,
		repo,
		put: bucket.putIfKeyExists,
	};
}

afterEach(() => vi.restoreAllMocks());

describe("X Article discovery", () => {
	test("reported status with prose and an expanded article entity uses fxembed with the original status URL", async () => {
		const { service, ctx, embed, api, resolve } = wire();
		const result = await service.fetchTwitterData(ctx, STATUS_URL);

		expect(result).toMatchObject({
			kind: "article",
			sourceUrl: STATUS_URL,
			viaFxEmbedHtml: expect.stringContaining(BODY),
			fallbackTweetInfo: null,
		});
		expect(embed).toHaveBeenCalledWith(
			"https://slaxfxembed.workers.dev/twitter/isnail/status/2100956349601624464",
			expect.anything()
		);
		expect(api).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});

	test.each([
		ARTICLE_URL,
		"https://twitter.com/i/article/2100948109664866305",
		"https://x.com/isnail/article/2100956349601624464",
	])("discovers prose plus a direct URL: %s", async (link) => {
		const { service, ctx, resolve } = wire(`文章导语 ${link}`, null);
		expect((await service.fetchTwitterData(ctx, STATUS_URL)).kind).toBe(
			"article"
		);
		expect(resolve).not.toHaveBeenCalled();
	});

	test.each([`文章导语 ${SHORT_URL}`, SHORT_URL])(
		"resolves an unresolved short link: %s",
		async (text) => {
			const { service, ctx, resolve, embed, api } = wire(text, null);
			expect((await service.fetchTwitterData(ctx, STATUS_URL)).kind).toBe(
				"article"
			);
			expect(resolve).toHaveBeenCalledExactlyOnceWith(ctx, SHORT_URL);
			expect(embed).toHaveBeenCalledOnce();
			expect(api).not.toHaveBeenCalled();
		}
	);

	test("uses a raw entity when text and expanded destination are absent", async () => {
		const { service, ctx, tweet } = wire("文章导语", null);
		tweet.entities = {
			urls: [
				{ url: ARTICLE_URL, expanded_url: "", display_url: "", indices: [] },
			],
		};
		expect((await service.fetchTwitterData(ctx, STATUS_URL)).kind).toBe(
			"article"
		);
	});

	test.each([
		"https://example.com/article/123",
		"https://x.com.evil.test/i/article/123",
		"https://evilx.com/i/article/123",
		"https://example.com/?url=https://x.com/i/article/123",
		"https://x.com/i/article/123not-an-id",
		"https://x.com/u/status/123",
	])("ordinary or misleading expanded URL stays a tweet: %s", async (link) => {
		const { service, ctx, tweet, embed, api, resolve } = wire(
			`分享 ${SHORT_URL}`,
			link
		);
		expect(await service.fetchTwitterData(ctx, STATUS_URL)).toEqual({
			kind: "tweet",
			tweetInfo: tweet,
			quoteTweetHtml: "",
		});
		expect(embed).not.toHaveBeenCalled();
		expect(api).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
	});

	test("deduplicates unresolved links and bounds resolution attempts", async () => {
		const links = Array.from({ length: 8 }, (_, i) => `https://t.co/link${i}`);
		const { service, ctx, tweet, resolve, embed } = wire(
			`导语 ${links.join(" ")} ${links.join(" ")}`,
			null
		);
		resolve.mockResolvedValue("https://example.com/article/123");
		tweet.entities = {
			urls: [{ url: links[0], expanded_url: "", display_url: "", indices: [] }],
		};
		expect((await service.fetchTwitterData(ctx, STATUS_URL)).kind).toBe(
			"tweet"
		);
		expect(resolve).toHaveBeenCalledTimes(5);
		expect(new Set(resolve.mock.calls.map((call) => call[1])).size).toBe(5);
		expect(embed).not.toHaveBeenCalled();
	});

	test("a failed short link does not prevent discovery of a subsequent article", async () => {
		const { service, ctx, resolve } = wire(
			`导语 https://t.co/broken ${SHORT_URL}`,
			null
		);
		resolve.mockRejectedValueOnce(new Error("timeout"));
		expect((await service.fetchTwitterData(ctx, STATUS_URL)).kind).toBe(
			"article"
		);
	});
});

describe("X Article provider fallback", () => {
	test("an explicit author/article link uses its own status ID while preserving the saved source", async () => {
		const { service, ctx, embed, api } = wire(
			"推荐另一篇文章",
			"https://x.com/other/article/99999"
		);
		embed.mockRejectedValue(new Error("fxembed unavailable"));
		expect(await service.fetchTwitterData(ctx, STATUS_URL)).toMatchObject({
			kind: "article",
			sourceUrl: STATUS_URL,
		});
		expect(embed).toHaveBeenCalledWith(
			"https://slaxfxembed.workers.dev/twitter/other/article/99999",
			expect.anything()
		);
		expect(api).toHaveBeenCalledExactlyOnceWith(ctx.env, "99999");
	});

	test("a non-HTTP short-link destination is not an article", async () => {
		const { service, ctx, resolve, embed, api } = wire(
			`导语 ${SHORT_URL}`,
			null
		);
		resolve.mockResolvedValue("ftp://x.com/i/article/123");
		expect((await service.fetchTwitterData(ctx, STATUS_URL)).kind).toBe(
			"tweet"
		);
		expect(embed).not.toHaveBeenCalled();
		expect(api).not.toHaveBeenCalled();
	});

	test("a video article with a source element is usable", async () => {
		const { service, ctx, embed, api } = wire();
		embed.mockResolvedValue(
			new Response(
				'<html><body><article><video><source src="https://video.twimg.com/body.mp4"></video></article></body></html>'
			)
		);
		expect(await service.fetchTwitterData(ctx, STATUS_URL)).toMatchObject({
			kind: "article",
			viaFxEmbedHtml: expect.stringContaining("body.mp4"),
		});
		expect(api).not.toHaveBeenCalled();
	});

	test("article failure retains quote rendering and tweet media", async () => {
		const { service, ctx, tweet, embed, api, put } = wire();
		tweet.quoted_tweet = {
			url: "https://x.com/quoted/status/555",
		} as TweetInfo;
		tweet.extendedEntities = {
			media: [
				{
					type: "photo",
					media_url_https: "https://pbs.twimg.com/original.jpg",
				},
			],
		} as TweetInfo["extendedEntities"];
		embed
			.mockRejectedValueOnce(new Error("fxembed unavailable"))
			.mockResolvedValueOnce(
				new Response(
					'<html><head><meta property="og:description" content="quoted content"></head><body></body></html>'
				)
			);
		api.mockRejectedValue(new Error("API unavailable"));
		const result = await service.fetchAndSaveTwitter(
			ctx,
			STATUS_URL,
			42,
			"article-test"
		);
		expect(result.textContent).toBe(tweet.text);
		expect(put).toHaveBeenCalledWith(
			"html/body/article-test.html",
			expect.stringContaining("quoted content")
		);
		expect(put).toHaveBeenCalledWith(
			"html/body/article-test.html",
			expect.stringContaining("original.jpg")
		);
	});

	test.each([
		'<html><head><meta property="og:description" content="预览"></head><body>预览</body></html>',
		"<html><body><article>  </article></body></html>",
		'<html><body><article><img src=""></article></body></html>',
		'<html><body><article><script>window.__PREVIEW__ = true</script><style>.preview { display: none }</style></article></body></html>',
	])(
		"HTTP 200 without usable article content falls back using the status ID",
		async (html) => {
			const { service, ctx, embed, api, article } = wire();
			embed.mockResolvedValue(new Response(html));
			const result = await service.fetchTwitterData(ctx, STATUS_URL);
			expect(result).toEqual({
				kind: "article",
				sourceUrl: STATUS_URL,
				viaFxEmbedHtml: null,
				fallbackTweetInfo: article,
			});
			expect(api).toHaveBeenCalledExactlyOnceWith(
				ctx.env,
				"2100956349601624464"
			);
			expect(embed.mock.invocationCallOrder[0]).toBeLessThan(
				api.mock.invocationCallOrder[0]
			);
		}
	);

	test("an embed transport failure falls back to the article API", async () => {
		const { service, ctx, embed, api } = wire();
		embed.mockRejectedValue(new Error("fxembed unavailable"));
		expect(await service.fetchTwitterData(ctx, STATUS_URL)).toMatchObject({
			kind: "article",
			viaFxEmbedHtml: null,
		});
		expect(api).toHaveBeenCalledExactlyOnceWith(ctx.env, "2100956349601624464");
	});

	test("media-only article content is usable", async () => {
		const { service, ctx, embed, api } = wire();
		embed.mockResolvedValue(
			new Response(
				'<html><body><article><img src="https://pbs.twimg.com/body.jpg"></article></body></html>'
			)
		);
		expect(await service.fetchTwitterData(ctx, STATUS_URL)).toMatchObject({
			kind: "article",
			viaFxEmbedHtml: expect.stringContaining("body.jpg"),
		});
		expect(api).not.toHaveBeenCalled();
	});

	test.each([
		undefined,
		{ contents: [] },
		{ contents: [{ type: "unstyled", text: " " }] },
		{ contents: [{ type: "image", url: "" }] },
	])("empty API content preserves the tweet", async (response) => {
		const { service, ctx, embed, api, tweet } = wire();
		embed.mockRejectedValue(new Error("fxembed unavailable"));
		api.mockResolvedValue(response as TweetArticleInfo);
		expect(await service.fetchTwitterData(ctx, STATUS_URL)).toEqual({
			kind: "tweet",
			tweetInfo: tweet,
			quoteTweetHtml: "",
		});
		expect(api).toHaveBeenCalledOnce();
	});

	test("both providers failing still saves the original tweet", async () => {
		const { service, ctx, embed, api, tweet, put, repo } = wire();
		embed.mockRejectedValue(new Error("fxembed unavailable"));
		api.mockRejectedValue(new Error("API unavailable"));
		const result = await service.fetchAndSaveTwitter(
			ctx,
			STATUS_URL,
			42,
			"article-test"
		);
		expect(result.textContent).toBe(tweet.text);
		expect(put).toHaveBeenCalledWith("text/body/article-test.txt", tweet.text);
		expect(repo.updateBookmark).toHaveBeenCalledWith(
			42,
			expect.objectContaining({ status: "success" })
		);
		expect(api).toHaveBeenCalledOnce();
	});

	test("direct internal article URLs never send the internal ID to the status-ID API", async () => {
		const { service, ctx, embed, api } = wire();
		embed.mockRejectedValue(new Error("fxembed unavailable"));
		await expect(service.fetchTwitterData(ctx, ARTICLE_URL)).rejects.toThrow();
		expect(api).not.toHaveBeenCalled();
	});

	test("direct author/article URLs retain their status-ID API fallback", async () => {
		const { service, ctx, embed, api } = wire();
		embed.mockRejectedValue(new Error("fxembed unavailable"));
		expect(
			(
				await service.fetchTwitterData(
					ctx,
					"https://x.com/isnail/article/2100956349601624464"
				)
			).kind
		).toBe("article");
		expect(api).toHaveBeenCalledExactlyOnceWith(ctx.env, "2100956349601624464");
	});

	test.each(["fxembed", "api"])(
		"%s content is saved as reader HTML and downstream text with the original source",
		async (provider) => {
			const { service, ctx, embed, put, repo } = wire();
			if (provider === "api")
				embed.mockRejectedValue(new Error("fxembed unavailable"));
			const fetched = await service.fetchTwitterData(ctx, STATUS_URL);
			expect(fetched).toMatchObject({ kind: "article", sourceUrl: STATUS_URL });
			const result = await service.parseAndSaveTwitter(
				ctx,
				fetched,
				42,
				"article-test"
			);
			expect(result.textContent).toContain(BODY);
			expect(put).toHaveBeenCalledWith(
				"text/body/article-test.txt",
				expect.stringContaining(BODY)
			);
			expect(put).toHaveBeenCalledWith(
				"html/body/article-test.html",
				expect.stringContaining(BODY)
			);
			expect(repo.updateBookmark).toHaveBeenCalledWith(
				42,
				expect.objectContaining({ status: "success", title: "完整文章" })
			);
			expect(repo.updateBookmark.mock.calls[0][1]).not.toHaveProperty(
				"target_url"
			);
		}
	);
});
