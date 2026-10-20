# Conceptual camera accent checkpoint

2026-10-20. The static original illustration is the shipped fallback. `PhotographyAccent` defaults `enabled=false`; do not enable it from configuration until all remaining gates pass. The procedural model is a stylized interpretation of one image; the rear and underside are inferred, not reconstructed measurements.

## Actual execution

- Read the installed img2threejs router and intake, quality, gate, correction and material contracts. Created the original conceptual reference using imagegen and recorded its provenance. No source photograph of a real guest or operator equipment was used for the accent.
- Reference admission, local spec search, assessment, nine-detail inventory, subject-specific hierarchy and five verified material crops are saved alongside the spec. Reference PBR confidence ranges 0.716–0.860; this is single-image inference, not recovered physical material data.
- Used Playwright Agent CLI for the initial browser inspection and `capture-review.mjs` for reproducible real Chromium captures at 15°, 0°, 90°, 180° and 270° plus a map-stripped frame. The skill's referenced runtime mesh-export script is absent from this installed package; the capture helper exports equivalent world-space vertices, normals and indices.
- Blockout corrections fixed framing, top controls, rounded housing and primitive tessellation. `blockout-rounded-tier1.json` passed with silhouette IoU 0.879, aspect delta 0.039 and scale delta 0.0266.
- Structural correction replaced ignored repetition positions with eight explicit fastener components, seated controls and a narrower collar. `structural-correction1-tier1.json` passed at IoU 0.8797. Four required azimuths passed without silhouette collapse or holes. All 11,190 vertices were sampled: zero inside and zero undecided vertices. Attachment checks report no worn/accessory attachments; this is not a physical assembly certification.
- Structural vision review accepted the component arrangement only. Repeated crop highlights, visible texture seams and missing fine optical detail were explicitly deferred and remain defects.
- The current form build adds eight socket centers (27 meshes). Its four-axis and volume checks pass; all 13,526 vertices were sampled with zero inside/undecided. Interior appearance difference was measured at 0.1401; that number is not a fidelity score.

## Current failed gate

`form-tier1.json` contains the actual failed diagnostic output: silhouette IoU 0.7386 (required 0.85), aspect delta 0.2133 (maximum 0.05), and scale delta 0.1664 (maximum 0.08). It also reports that 3% of foreground cells are outside the largest connected blob. The failure needs investigation of the current map-stripped render/mask and framing; do not infer its cause from the prior accepted structural image.

No AI `continue` decision was recorded for this failed form pass. The comparison sheet exists as an artifact but must not be used to bypass Tier 1. Durable state is `form-refinement / tier1-diagnostics`, 0 of 3 form corrections, 3 of 6 total corrections used. Later material, surface, lighting, interaction, optimization, part coverage and emission gates are incomplete.

## Resume exactly here

```powershell
python .agents/skills/img2threejs/forge/next.py --state docs/design/three/state.json docs/design/three/camera-sculpt-spec.json
node docs/design/three/preview-server.mjs
```

Follow the returned step and the installed correction contract. Factory output belongs at `src/modules/photography/three/createCameraModel.ts` (override the generic tool's example `src/createObjectModel.ts`). Preserve subject choices in `author-spec.py` and hand geometry refinements in `refine-factory.mjs` before regeneration. The preview server is loopback-only on port 4177; browser captures require it.

After the form gate passes, remove baked highlight tiling through a material-scoped correction using the saved finish analyses. The skill recommends solid albedo for flat paint; reference crop textures are not automatically valid surface maps. Five extracted crop maps are only 256 px while the current material quality contract expects 1024 px, so the material pass has not met its resolution or controlled-view requirements. Do not lower thresholds to accept the existing artifacts.

## Runtime limits still to verify

The island code has lazy photography-only loading, static poster before load, reduced-motion/data-saver/mobile/WebGL fallback, user pause, offscreen/hidden-document pause, bounded DPR and disposal. These safeguards exist in code; enabled runtime lifecycle/performance is not yet verified. The current generated material URLs are preview-relative, so they are unsuitable for an enabled deployed island. Final material wiring must remove that dependency or serve approved assets deliberately.

The draw-call/triangle budget, neutral/grazing lighting, visible-footprint material comparisons, clickable/explodable part coverage and enabled route browser tests remain required. The website uses the static illustration while these gates remain unfinished.
