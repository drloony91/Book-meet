import test from "node:test";
import assert from "node:assert/strict";
import { bookSourceFromUrl, fetchBookProduct, marketplaceFromUrl, publisherSalesLinks } from "../server/api.js";
import { cleanUrl } from "../server/modules/material-input.js";

function response({ status = 200, html = "", headers = {} } = {}) {
  const normalizedHeaders = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => normalizedHeaders.get(String(name).toLowerCase()) ?? null },
    text: async () => html,
  };
}

async function rejectsWithStatus(work, expectedStatus) {
  await assert.rejects(work, (error) => {
    assert.equal(error?.statusCode, expectedStatus);
    return true;
  });
}

test("malformed profile and marketplace URLs are classified as client errors", async () => {
  assert.equal(cleanUrl(""), "");
  assert.throws(() => cleanUrl("publisher.example"), (error) => error?.statusCode === 400);
  assert.throws(() => cleanUrl("ftp://publisher.example/books"), (error) => error?.statusCode === 400);
  assert.throws(() => publisherSalesLinks([{ label: "Store", url: "not a URL" }]), (error) => error?.statusCode === 400);
  assert.throws(() => marketplaceFromUrl("not a URL"), (error) => error?.statusCode === 400);
  assert.throws(() => bookSourceFromUrl("not a URL"), (error) => error?.statusCode === 400);
  assert.throws(() => bookSourceFromUrl("https://example.com/book"), (error) => error?.statusCode === 400);
});

test("marketplace preview parses Flip, Marwin and Yandex fixtures", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const fixtures = new Map([
    ["flip.kz", `<script type="application/ld+json">{"@type":"Product","name":"Flip Book","author":{"name":"Flip Author"},"isbn":"9781234567890","offers":{"price":"4200","priceCurrency":"KZT"}}</script>`],
    ["meloman.kz", `<span data-ui-id="page-title-wrapper">Marwin Book</span><table><tr><td data-th="Автор">Marwin Author</td></tr></table>`],
    ["books.yandex.kz", `<script type="application/ld+json">{"@type":"Book","name":"Yandex Book","author":{"name":"Yandex Author"}}</script>`],
  ]);
  globalThis.fetch = async (url) => response({ html: fixtures.get(new URL(url).hostname) });

  const flip = await fetchBookProduct("https://flip.kz/catalog?prod=1");
  assert.deepEqual({ marketplace: flip.marketplace, title: flip.title, author: flip.author, action: flip.suggestedAction }, { marketplace: "Flip", title: "Flip Book", author: "Flip Author", action: "Купить" });
  const marwin = await fetchBookProduct("https://meloman.kz/book");
  assert.deepEqual({ marketplace: marwin.marketplace, title: marwin.title, author: marwin.author, action: marwin.suggestedAction }, { marketplace: "Marwin/Меломан", title: "Marwin Book", author: "Marwin Author", action: "Купить" });
  const yandex = await fetchBookProduct("https://books.yandex.kz/audiobooks/book");
  assert.deepEqual({ marketplace: yandex.marketplace, title: yandex.title, author: yandex.author, action: yandex.suggestedAction }, { marketplace: "Яндекс.Книги", title: "Yandex Book", author: "Yandex Author", action: "Слушать" });
});

test("marketplace preview maps upstream and parser failures away from HTTP 500", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  context.after(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  });
  console.warn = () => {};

  globalThis.fetch = async () => response({ status: 503 });
  await rejectsWithStatus(() => fetchBookProduct("https://flip.kz/catalog?prod=1"), 502);

  globalThis.fetch = async () => response({ status: 200, html: "<html><title>Store page</title></html>" });
  await rejectsWithStatus(() => fetchBookProduct("https://meloman.kz/book"), 422);

  globalThis.fetch = async () => response({ status: 200, html: "x", headers: { "content-length": 5 * 1024 * 1024 + 1 } });
  await rejectsWithStatus(() => fetchBookProduct("https://books.yandex.kz/book"), 502);

  globalThis.fetch = async () => { throw Object.assign(new Error("request aborted"), { name: "AbortError" }); };
  await rejectsWithStatus(() => fetchBookProduct("https://flip.kz/catalog?prod=1"), 502);

  globalThis.fetch = async () => { throw new Error("DNS unavailable"); };
  await rejectsWithStatus(() => fetchBookProduct("https://flip.kz/catalog?prod=1"), 502);
});

test("marketplace preview follows safe redirects and classifies broken redirect chains", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  context.after(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  });
  console.warn = () => {};

  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) return response({ status: 302, headers: { location: "/catalog?prod=2" } });
    return response({ html: `<script type="application/ld+json">{"@type":"Product","name":"Redirected Flip Book","author":{"name":"Flip Author"}}</script>` });
  };
  const redirected = await fetchBookProduct("https://flip.kz/catalog?prod=1");
  assert.equal(redirected.title, "Redirected Flip Book");
  assert.equal(requestCount, 2);

  globalThis.fetch = async () => response({ status: 302, headers: { location: "http://[" } });
  await rejectsWithStatus(() => fetchBookProduct("https://flip.kz/catalog?prod=1"), 502);

  globalThis.fetch = async () => response({ status: 302, headers: { location: "/catalog?loop=1" } });
  await rejectsWithStatus(() => fetchBookProduct("https://flip.kz/catalog?prod=1"), 502);
});
