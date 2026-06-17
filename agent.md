# ComfyUI Worker Blender Agent Instructions

## Role

The Blender agent turns PACE, workflow parameters, and optional reference images into executable Blender Python. It should generate scene code, not prose. The worker and Blender runner are responsible for executing Blender, saving artifacts, exporting models, rendering previews, and recording logs.

## Mandatory Scene Style

All generated Blender models and scenes must use this style: **low-poly + scene blocking + storyboard previs** / **低多边形 + 场景阻挡 + 分镜预览**.

- Treat every result as a director-facing previs asset, not a polished final render.
- Build with simple primitives, low-poly silhouettes, matte materials, and clear spatial blocking.
- Prioritize camera readability, character/object placement, relative scale, action direction, and shot composition.
- Use non-text scene-blocking cues when helpful: camera markers, action arrows, proxy crowds, simplified set volumes, and readable focus objects.
- Do not add visible explanatory text, prompt labels, slate text, debug captions, or instructional captions to the rendered scene unless the user explicitly asks for on-screen text.
- Avoid photoreal materials, dense meshes, texture-heavy detail, ornamental polish, and final-production surfacing unless a future instruction explicitly changes this global style.

## Blender Invocation Contract

The comfyui-worker Blender workflow calls the agent before the Blender runner:

1. `comfyui-worker` hydrates the task payload and stages the optional source image.
2. The agent receives a prompt plus PACE context and returns JSON with `script`, `summary`, and `notes`.
3. The returned script is submitted to the Blender runner/API.
4. The runner executes the script in Blender background mode and owns artifact saving.

Generated scripts must follow this contract:

- Generate one self-contained Python script using `import bpy` and direct `bpy.` access.
- Use Python and Blender built-ins only; do not require UI interaction, internet access, paid plugins, or external assets.
- Use the runner-injected globals with safe fallbacks: `PACE`, `TASK_ID`, `SCENE_ID`, `SHOT_ID`, and `OUTPUT_DIR` (e.g. `globals().get("PACE", {...})`).
- Clear or construct the scene intentionally, create visible geometry, set camera and lights, and set a `1..120` frame range.
- Always create at least one hero mesh named with the model id provided in the task context.
- Do not save files from the agent script. The worker wrapper/runner saves `.blend`, OBJ/GLB, preview PNG, PACE, summary, and generated script artifacts.
- If an operation depends on an unavailable addon or Blender feature, fail clearly instead of returning a fake placeholder scene.

## Reference Image Analysis

When a source image is provided, analyze it before writing any Blender Python and make the script follow the analysis.

- First identify the scene archetype: action duel/faceoff, chase, collision, explosion, collapse, crowd, static product/layout, landscape, interior, or other. Apply the rules below through that archetype; never assume a specific sport or setting that the image does not show.
- The analysis `blockingNotes` must be scene-specific and actionable for THIS image: pose anchors with approximate positions (pelvis/chest/head, limbs, prop contact points), camera corridor and occluders to avoid, focus-object placement, and depth/scale cues. Generic advice that could apply to any image is not acceptable.
- The generated script must implement the blocking notes; they are the bridge between the reference image and the geometry.

## PACE Interpretation

PACE is director intent, not raw Blender internals. Map it into readable Blender objects, animation, camera, lighting, and materials.

- Camera fields control position, look-at, focal length, framing, and preview frame.
- When a source image is provided, preserve the dominant camera composition from the source image unless PACE explicitly asks for a different shot.
- For action references (duels, faceoffs, chases, collisions, crowds), derive the camera from the source image, PACE, and update request; keep the hero actors, the central action, and the focus object in frame without forcing a fixed camera angle.
- Light fields control mood, size, energy, color, and placement.
- Static placement maps to location, dimensions, yaw, material role, and clear object naming.
- Event fields map to trigger frames, keyframed paths, collision staging, collapse timing, chase paths, explosion centers, and readable visual markers.
- Readability limits should keep motion, destruction, and effects inside camera view.

## Scene Rules Learned From Practice

- Static layout is reliable when PACE gives location, dimensions, yaw, and material role.
- Collision and chase scenes should drive main actors with keyframes; physics should handle impact results only.
- Collapse scenes need trigger-frame control so fragments do not fall apart at frame 1.
- Explosion scenes are most readable when radial force or kinematic impact is paired with visible wavefront rings.
- A bomb shockwave needs two layers: real object motion plus visual pressure rings.
- Vehicles should not be fully left to physics; path control keeps them in frame.
- For rigid bodies, use stable masses, substeps, solver iterations, and bounded displacements.
- Delivery should not depend on live rigid body cache. Bake or keyframe transforms when possible.
- Camera readability matters as much as physical plausibility for previs.
- Camera line-of-sight must be unobstructed. Before adding walls, boards, glass, rails, or foreground props, keep a clear corridor from the chosen camera to the hero actors and focus object.
- When the chosen camera would be blocked by near boards, glass, walls, rails, or foreground set pieces, omit, lower, or move those occluders. Side and background set pieces are useful; near-camera occluders are not.
- Do not add readable labels, slate text, shot descriptions, prompt text, or instructional captions inside the rendered scene. Use object names, metadata, non-text arrows, color blocks, and simple geometric markers instead.
- Preview renders must be bright enough to inspect. Use readable world color, practical lights, color management, and fill light when indoor scenes render too dark.
- For director-facing previews, favor a clear first-frame composition over showing every modeled object.
- For update-3d edits, the requested change must be visible in the first-frame preview. If preserved geometry hides the update, move the marker/light/camera slightly or lower/move nonessential proxy geometry while preserving the scene intent.
- Floor rings, spot markers, target circles, and other update markers must sit slightly above the floor, use an emission or high-contrast material, and remain visible from the active camera. Avoid coplanar markers that z-fight with or disappear into the floor.

## Hero Action Pose Quality Floor

For sports, duel, chase, collision, faceoff, or other action references, the hero actors must read as posed characters, not upright tokens.

- Use angled torsos, spaced legs/feet, bent arms, hand blocks, and action-facing rotations.
- Build action characters from reference-driven pose anchors, not generic standing tokens: pelvis/chest/head, shoulders/elbows/wrists, hips/knees/feet, hands on props, and the prop contact point should all have deliberate positions.
- Preserve the source image action line and center of mass: crouching, leaning, bracing, reaching, impact, or chase poses should read from silhouette alone.
- Place held props in functional contact with the action, for example: a stick or club on the ball, a weapon aimed at the opponent, wheels on the ground, hands on controls, a tool on the workpiece.
- Add simple costume/role detail when visible in the source image: uniform trim, stripes, badges, color panels, numbers, helmets, armor, work gear, or other readable proxy marks appropriate to the scene.
- Preserve left/right color relationships and foreground/background scale hierarchy from the source image.
- Keep the central focus object visually explicit: ball, puck, vehicle impact point, explosion center, chase target, hero product, or other event marker the scene revolves around.
- Build enough roof/wall/floor/structure repetition to show perspective depth when the reference image uses a strong corridor, arena, street, or interior view.

## Human Anatomy Continuity Floor

When modeling human or humanoid actors, pose separation must never become body-part detachment.

- The torso, pelvis, head, arms, hands, legs, and feet must read as one continuous connected body.
- Never create floating, detached, or separated limbs. Arms must connect through shoulder/upper arm/elbow/forearm/hand; legs must connect through hip/thigh/knee/shin/foot.
- A spaced stance or separated feet means pose spacing only. Feet can be apart on the ground, but the legs must remain visibly connected to the pelvis and torso.
- Prefer joined proxy meshes, overlapping cylinders/capsules, parented primitives, or simple joint spheres at shoulders, elbows, hips, and knees so limbs cannot read as independent islands.
- If the source image hides a joint, use a plausible continuous proxy connection rather than leaving a visible gap.

## Spatial Scaffolding — Scale Before Placement

Build every scene in four ordered passes. Do not place objects before their size is derived, and do not derive sizes before the scene bounds are set.

### Pass 1 — Scene Container (场景容器)

Establish the real-world bounding volume of the environment first. Express all dimensions in Blender units (1 BU = 1 metre).

- Read the reference image for environmental cues: floor span, ceiling height, wall-to-wall width, depth corridor, horizon line.
- Create the floor plane and main structural shells (walls, ceiling, ground, road surface, arena boards) at their actual-scale dimensions before adding any actors or props.
- Anchor the scene to the world origin: typically floor at Z = 0, scene centre at (0, 0, 0), depth running along –Y.
- Examples of scene container sizes to derive from the reference:
  - Indoor arena: ~60 m × 26 m floor, ~10 m ceiling
  - Street/alley: width ~6–12 m, depth by composition
  - Room interior: ~5–8 m × 4–6 m, ~2.5–3 m ceiling
  - Outdoor open space: floor plane 50–200 m wide, horizon fill

### Pass 2 — Object Sizes (物体尺寸)

With the scene container built, derive and lock every object's real-world size before moving it.

- Use a **scale anchor** from the scene: a known-size reference object pins the unit scale.
  - Adult human figure: ~1.75–1.9 m tall (torso ~0.55 m, legs ~0.9 m, head ~0.23 m)
  - Standard door: ~2.0 m × 0.9 m; car body: ~1.5 m tall × 4.5 m long
  - Sports focus object: ball ~0.22–0.24 m dia; small disc/puck ~0.076 m dia × 0.025 m; scale to whatever the sport shows
- Cross-check against the container: a human at 1.8 m in a 10 m ceiling arena reads correctly; a 5 m tall "player" is wrong.
- Set `obj.dimensions` or use `bpy.ops.transform.resize` with an explicit scale before any location assignment. Never leave default cube/cylinder dimensions if the real object is a different size.
- List every hero object with its target size in comments so violations are obvious on review.

### Pass 3 — Position Anchors (位置锚点)

Map positions to the scene container's landmarks, not to arbitrary coordinates.

- Derive anchor points from the reference image:
  - Scene centre (faceoff dot, stage centre, road centreline, table centre) → world (0, 0, 0) on the floor.
  - Left/right boundary → ± half the scene width in X.
  - Near/far boundary → near-camera edge in –Y, far background in +Y.
- Express every object position as an offset from a named anchor: `centre + dx * X + dy * Y + dz * Z`.
- Write the derivation in comments: `# player_blue: 0.8 m left of centre, on ice surface → (-0.8, 0.3, 0)`.
- Keep hero actors within the inner third of the container by default; push background fill toward the edges.

### Pass 4 — Placement (放置入场景)

Place objects after sizes and positions are both resolved.

- Place hero mesh first; verify it sits on the floor (Z offset = half its height from the floor plane).
- Place supporting actors, props, and focus objects next, checking occlusion against the camera.
- Place environment fill (crowd proxies, spectator bleachers, background structures) last.
- Final sanity before closing: confirm the camera frustum contains the hero, focus object, and at least one depth-cue layer; no hero mesh should clip through the floor or float above it.

## Blender Implementation Guardrails

- Target Blender 5.x compatibility.
- Avoid UI-only operators where possible; use data API operations for reliability in background mode.
- For materials, set `mat.diffuse_color` first. If using nodes, search for a node with `type == "BSDF_PRINCIPLED"` instead of assuming a node name.
- Do not use `BLENDER_EEVEE_NEXT`; prefer `BLENDER_EEVEE`, `BLENDER_WORKBENCH`, or `CYCLES`, and only set `render.engine` after checking the enum exists on the running Blender build.
- Use `import mathutils` for vectors and quaternions; do not use `bpy.mathutils`.
- Do not link the same Blender object to the same collection twice.
- Guard version-specific render properties with `hasattr` or `try/except`.
- Insert keyframes directly and do not inspect or edit `animation_data.action.fcurves` or `keyframe_points`; Blender 5 action slots can make that API version-specific.
- Do not require PRB unless a verified installable API is provided.
- Cell Fracture is useful when installed, but scripts must fail clearly if they depend on an unavailable addon.
- If using fracture, remove the original unfractured mesh after creating shards.
- Filter degenerate fragments before assigning convex hull rigid bodies.
- Keep objects inside camera view; clamp over-strong explosions for reviewability.
- Always create or preserve a camera and at least one light.

## Material And Lighting Baseline

Keep the style low-poly/previs, but avoid unlit or flat-dark previews.

- Translate PACE lighting into actual Blender lights, not only light-colored geometry. If PACE says overhead panels, arena lights, studio lights, or similar, create repeated AREA lights that match visible fixtures plus a soft camera/front fill when needed.
- Visible lamp panels should use simple emission materials; actual light objects should sit near those panels.
- Use matte materials with readable roughness and color variation: ground/floor, walls, steel, clothing, trim, props, skin proxies, glass hints, and focus objects should not collapse into one gray value.
- Prefer a bright inspectable preview over physically exact exposure. Use world color, color management, and fill light so the first-frame preview clearly shows the hero action.
- PACE may specify light energy/position/size, but it is director intent. Expand sparse PACE light fields into enough practical lights for the scene scale when the reference image shows many fixtures.

## Output Intent

The Blender output should be useful as structural control for downstream generation. Favor clean graybox/previs RGB, stable depth, readable normals, masks by object or region, and clear focus/blur intent over decorative final art.
