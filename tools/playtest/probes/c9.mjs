// C9 acceptance: head metadata, icon stack, color-scheme, scrollbars, -webkit- prefixes, og-card, mark.svg.
// Usage: cd tools/playtest && node probes/c9.mjs
import fs from "node:fs";
import path from "node:path";
import { openProbe, ROOT } from "./_lib.mjs";

const P = await openProbe("c9");
const { page } = P;
await P.goto(null);
const g = (fn, arg) => page.evaluate(fn, arg);

const head = await g(() => ({
  description: document.querySelector('meta[name="description"]')?.content || "",
  ogImage: document.querySelector('meta[property="og:image"]')?.content || "",
  ogW: document.querySelector('meta[property="og:image:width"]')?.content, ogH: document.querySelector('meta[property="og:image:height"]')?.content,
  twitter: document.querySelector('meta[name="twitter:card"]')?.content,
  canonical: document.querySelector('link[rel="canonical"]')?.href,
  themeColor: document.querySelector('meta[name="theme-color"]')?.content,
  colorSchemeMeta: document.querySelector('meta[name="color-scheme"]')?.content,
  colorScheme: getComputedStyle(document.documentElement).colorScheme,
  viewport: document.querySelector('meta[name="viewport"]')?.content,
  icon32: document.querySelector('link[rel="icon"][sizes="32x32"]')?.getAttribute("href"),
  icon16: document.querySelector('link[rel="icon"][sizes="16x16"]')?.getAttribute("href"),
  iconSvg: document.querySelector('link[rel="icon"][type="image/svg+xml"]')?.getAttribute("href"),
  apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"),
  logoIcon: Array.from(document.querySelectorAll('link[rel~="icon"]')).some((l) => /logo\.svg/.test(l.getAttribute("href") || "")),
  brandAlt: document.querySelector(".brand img")?.getAttribute("alt"),
  fontPreload: !!document.querySelector('link[rel="preload"][as="font"][crossorigin]'),
  assetVersion: document.querySelector('meta[name="asset-version"]')?.content,
  scrollbar: ["#storyModal .modalBody", "#screenMenu", ".helpBody"].map((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).scrollbarWidth : null; })
}));
P.check("meta description 50-160 chars", head.description.length >= 50 && head.description.length <= 160, `${head.description.length} chars`);
P.check("og:image absolute https + 1200x630 + twitter summary_large_image", /^https:\/\/typer198x\.com\/assets\/ui\/og-card\.jpg$/.test(head.ogImage) && head.ogW === "1200" && head.ogH === "630" && head.twitter === "summary_large_image", JSON.stringify({ ogImage: head.ogImage, ogW: head.ogW, ogH: head.ogH }));
P.check("canonical https://typer198x.com/", head.canonical === "https://typer198x.com/", head.canonical);
P.check("theme-color #0B1030, color-scheme meta dark, computed colorScheme dark", head.themeColor === "#0B1030" && head.colorSchemeMeta === "dark" && head.colorScheme === "dark", JSON.stringify({ themeColor: head.themeColor, meta: head.colorSchemeMeta, computed: head.colorScheme }));
P.check("viewport has viewport-fit=cover", /viewport-fit=cover/.test(head.viewport || ""), head.viewport);
P.check("icon stack: mark.svg (any) + 32 + 16 PNG + apple-touch-icon; none points at logo.svg", /mark\.svg$/.test(head.iconSvg || "") && !!head.icon32 && !!head.icon16 && !!head.apple && !head.logoIcon, JSON.stringify({ svg: head.iconSvg, icon32: head.icon32, apple: head.apple, logoIcon: head.logoIcon }));
P.check(".brand img has alt text", head.brandAlt === "Type-R 198X", head.brandAlt);
P.check("font preload carries crossorigin", head.fontPreload);
P.check("themed scrollbars: scrollbar-width thin on .modalBody/.screen/.helpBody", head.scrollbar.every((v) => v === "thin"), JSON.stringify(head.scrollbar));

// Icon and image URLs answer 200 from the harness server.
const base = P.base.replace(/index\.html$/, "");
async function status(href) {
  const url = new URL(href, base).toString();
  const res = await page.request.get(url);
  return { url, status: res.status(), bytes: (await res.body()).length, type: res.headers()["content-type"] };
}
for (const [label, href] of [["icon 32x32", head.icon32], ["icon 16x16", head.icon16], ["mark.svg", head.iconSvg], ["apple-touch-icon", head.apple], ["og-card.jpg", "./assets/ui/og-card.jpg"]]) {
  const r = href ? await status(href) : { status: 0 };
  P.check(`${label} returns 200`, r.status === 200, JSON.stringify(r));
}

// og-card.jpg is 1200x630 and <= 250 KB; apple-touch-icon 180x180; mark.svg square and error-free.
const ogPath = path.join(ROOT, "assets/ui/og-card.jpg");
const ogBytes = fs.existsSync(ogPath) ? fs.statSync(ogPath).size : 0;
const dims = await g(async (srcs) => {
  const load = (src) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve({ src, w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => resolve({ src, w: 0, h: 0, error: true }); i.src = src + "?probe=" + Date.now(); });
  return Promise.all(srcs.map(load));
}, ["./assets/ui/og-card.jpg", "./assets/ui/apple-touch-icon.png", "./assets/ui/mark.svg"]);
const og = dims[0], apple = dims[1], mark = dims[2];
P.check("og-card.jpg 1200x630 and <= 250 KB", og.w === 1200 && og.h === 630 && ogBytes > 0 && ogBytes <= 250 * 1024, JSON.stringify({ ...og, bytes: ogBytes }));
P.check("apple-touch-icon.png 180x180 (derived from mark.svg)", apple.w === 180 && apple.h === 180, JSON.stringify(apple));
P.check("mark.svg loads square, no console error", mark.w === mark.h && mark.w > 0 && !mark.error && P.errors.consoleErrors.length === 0, JSON.stringify(mark));

// Every backdrop-filter in both stylesheets is immediately preceded by -webkit-backdrop-filter.
function prefixCheck(file) {
  const css = fs.readFileSync(path.join(ROOT, file), "utf8");
  const lines = css.split("\n");
  const bad = [];
  lines.forEach((ln, i) => {
    if (/^\s*backdrop-filter\s*:/.test(ln)) {
      const prev = lines[i - 1] || "";
      const want = ln.replace(/^\s*backdrop-filter/, "-webkit-backdrop-filter").trim();
      if (prev.trim() !== want) bad.push(`${file}:${i + 1}`);
    }
  });
  const total = lines.filter((ln) => /^\s*backdrop-filter\s*:/.test(ln)).length;
  return { total, bad };
}
const pfx = [prefixCheck("style.css"), prefixCheck("assets/style/tokens.css")];
P.check("-webkit-backdrop-filter immediately precedes every backdrop-filter", pfx.every((p) => p.bad.length === 0) && pfx[0].total + pfx[1].total > 0, JSON.stringify(pfx));
const userSelect = fs.readFileSync(path.join(ROOT, "assets/style/tokens.css"), "utf8");
P.check(".btn-arcade carries -webkit-user-select / -webkit-touch-callout", /-webkit-user-select:\s*none/.test(userSelect) && /-webkit-touch-callout:\s*none/.test(userSelect));
P.check("@supports fallback for missing backdrop-filter exists", /@supports not \(\(-webkit-backdrop-filter/.test(userSelect));

// Secondary pages link back and the footer points at the privacy policy.
const foot = await g(() => Array.from(document.querySelectorAll(".footer a")).map((a) => a.getAttribute("href")));
const AV = head.assetVersion;
P.check("footer links: privacy-policy + support, each carrying ?v=<asset-version> (release 20261024a, CT-02: the host caches *.html 180 days)",
  foot.includes(`./privacy-policy.html?v=${AV}`) && foot.includes(`./support.html?v=${AV}`), JSON.stringify({ foot, AV }));
const pp = await status("./privacy-policy.html");
P.check("privacy-policy.html returns 200", pp.status === 200, JSON.stringify(pp));
// Every in-site page link (and the privacy.html meta refresh) in the five pages carries the shell token (R2 / CT-02;
// tools/bump-version.sh keeps them in step).
const pageLinks = {};
for (const f of ["index.html", "info.html", "support.html", "privacy-policy.html", "privacy.html"]) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  pageLinks[f] = [...src.matchAll(/(?:<a\b[^>]*\bhref|\burl)=["']?(\.\/[a-z-]+\.html[^"' >]*)/gi)].map((m) => m[1]);
}
const untokened = Object.entries(pageLinks).flatMap(([f, ls]) => ls.filter((u) => !u.endsWith(`?v=${AV}`)).map((u) => `${f}: ${u}`));
P.check("in-site page links in the five pages end in ?v=<asset-version> (back links, Play now, privacy.html refresh)",
  Object.values(pageLinks).flat().length >= 12 && untokened.length === 0, JSON.stringify({ untokened, counts: Object.fromEntries(Object.entries(pageLinks).map(([f, l]) => [f, l.length])) }));

// RET-1: the shell revalidates the long-lived documents for a returning browser (a save exists), and a first visit
// fetches none of them. Z11: not before the first keystroke (it would count in the boot budget): at idle after the
// first keydown / input, or 30 s after load for a visit that never types.
const docFetches = async ({ fallback = false } = {}) => {
  const seen = [];
  const on = (r) => { if (r.resourceType() === "fetch" && /\.html(\?|$)/.test(r.url())) seen.push(new URL(r.url()).pathname); };
  page.on("request", on);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(fallback ? 26000 : 4000);   // the guard used to fetch 2 s after load, then at idle
  const before = seen.slice().sort();
  if (!fallback) await page.keyboard.press("Shift");   // the first keystroke: a modifier, which the menu ignores
  await page.waitForTimeout(fallback ? 8000 : 4000);    // keystroke -> idle (at most 3 s); fallback at 30 s -> idle
  page.off("request", on);
  return { before, after: seen.sort() };
};
const PAGES = JSON.stringify(["/index.html", "/info.html", "/privacy-policy.html", "/support.html"]);
const fresh = await docFetches();
await P.goto("legacy-midwave");
const returning = await docFetches();
P.check("returning browser (save present): /index.html, privacy-policy.html, support.html, info.html revalidated once, none in the 4 s after load before the first keystroke and all four after it (Z11); a fresh save fetches none (RET-1)",
  fresh.after.length === 0 && returning.before.length === 0 && JSON.stringify(returning.after) === PAGES, JSON.stringify({ fresh, returning }));
const idle = await docFetches({ fallback: true });
P.check("returning browser that never types: none in the 26 s after load, all four by 34 s (the 30 s fallback, then idle; Z11)",
  idle.before.length === 0 && JSON.stringify(idle.after) === PAGES, JSON.stringify(idle));

await P.finish();
