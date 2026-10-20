# Illustrative catalog images

The owner requested generated or web images for sections without photography on 2026-10-20. Six new images were generated with the built-in image-generation tool: desert safari, coastal buggy, excursion boat, Red Sea coastline, coastal apartment and passenger transfer.

The images fill the existing composition on the homepage, experience catalog/details, destinations and apartment catalog/details. Existing owner trip images, the hero and previous-trip gallery remain unchanged. These images are illustrative, not evidence of actual inventory, named properties or past trips. A localized “Illustrative image” label and matching accessible description accompany them in all ten languages.

## Files and provenance

- Runtime assets: `public/images/editorial/{subject}-v1-{480,960,1440}.{avif,webp}`.
- Exact generation prompts and source artifact names: [editorial-imagery.json](editorial-imagery.json).
- Original and derivative hashes, dimensions and sizes: [editorial-media.json](../evidence/editorial-media.json).
- Original generated PNGs are preserved in ignored `.local/editorial-originals/`, with the tool's original output also left in place. Owner originals were not edited.
- Regeneration: `node scripts/prepare-editorial-media.mjs`, using the ignored workstation source mapping in `.local/editorial-generation.json`. Committed AVIF/WebP files are sufficient for builds and deployment; no generator credentials or source PNGs are required.

Responsive AVIF is preferred, with WebP fallback. Images are lazy-loaded except where the existing layout marks them as priority, and their container dimensions reserve space before decoding. No external image host or additional runtime SDK is used.

## Verification

Behavior tests were written and run before implementation: the image resolver was initially absent, and the browser asserted that the homepage contained no illustrative photos. Both failed as expected. The AVIF candidate test also failed before the compact source format was added.

The first working image pass exposed a payload-budget regression: 472,674 desktop and 130,094 mobile homepage image bytes. That prompted AVIF optimization; final measurements and the unchanged route budgets are recorded in [PERFORMANCE.md](../PERFORMANCE.md).

The final targeted suite checks local responsive sources, preserved owner images, all six subjects loading, visible captions, Arabic mobile layout, private access and automated accessibility. Final results and saved capture paths are appended to the release report. No database, payment, authorization or inventory behavior was changed.
