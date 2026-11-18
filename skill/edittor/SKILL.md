---
name: edittor
description: Build and refine edits in Edittor projects (a browser-based reel / short-video editor). Use when the user asks to "build a cut", "make a reel", "add scenes", "make a collage", "cut to the music", mentions an Edittor project or a project under ~/EdittorProjects. Requires the mcp__edittor__* tools. Reply in the user's language.
---

# Editing with Edittor

Edittor is a browser-based reel / short-video editor that stores each project in `~/EdittorProjects/<id>/project.json`.
Change projects **through the `mcp__edittor__*` tools, never by editing the file by hand**. The tools talk to the running server (default `http://127.0.0.1:5174`), so the editor shows every change instantly, and the user can undo each step with Ctrl+Z.

## Data model (summary)

- **Pool:** video / photo / audio items. Each has an `id`, size, duration and a **color grade**. The grade belongs to the item and applies everywhere it is used.
- **Scene:** scenes are sequential and contiguous. `duration` is in seconds. A scene holds 1–4 **cells (panels)**: 1 cell = single shot, 2–4 cells = collage. Collages may mix video and photos.
- **Cell:** `asset_id`, `fit` (cover / contain), `in` (source in-point of the video, i.e. slip), `enter_delay` (when the panel appears within the scene), `enter` (entrance animation), `motion` (Ken Burns move for photos).
- **Formats:** one project can target several aspect ratios (9:16, 4:5, 1:1, 16:9, …). **Layout (preset + weights), framing and text position are stored per format.** Content and timing are shared.
- **Layout presets:** `single`; 2 panels: `stack-2`, `row-2`; 3 panels: `stack-3`, `row-3`, `big-top-2`, `big-bottom-2`, `big-left-2`, `big-center-2`; 4 panels: `grid-4`, `stack-4`, `row-4`, `big-top-3`, `big-left-3`. `weights` are relative panel sizes (e.g. `[1,2,1]` makes the middle panel twice as large).
- **Text layers:** have independent timing (`start`, `duration`, `track`). `box` positions them per format (x, y = center in 0..1; `size` in px with the short side = 1080 reference).
- **Tempo:** `bpm` and `offset` (timeline time of the first beat). Durations can be given in `beats`.

## Workflow

1. Call `get_project` to see the pool, music and tempo. Use `look_at_assets` to view thumbnails when choosing shots (`strip: true` returns a 12-frame filmstrip for videos).
2. If there is music but no tempo, call `set_music(detect_tempo: true)`.
3. Build the edit: `replace_edit` for a fast first cut, `add_scenes` to extend an existing one.
4. Add text (`add_text`), grade (`set_grade`), and adapt layouts per format (`set_layout`) as needed.
5. Verify with `get_project` and give the user a short summary: scene count, total duration, notable choices.

## Editing rules (instrumental reels)

- **Cut on the beat.** Typical scenes are 2–8 beats: longer (6–12) at the open and close, rhythmic (2–4) in the middle. Match the total length to musical phrases (4- or 8-beat bars).
- **Bring collage panels in on beats**, e.g. a 3-panel collage with `enter_beat` 0, 2, 4 and `enter: "fade"` or `"slide-up"`.
- **In 9:16**, use landscape videos in `stack-2` / `stack-3` collages; portrait sources work well as single panels. **In 16:9**, prefer `row-*` and `big-left-*`.
- Don't use the same item twice in a row. For videos, pick the liveliest part with `in` (check the filmstrip).
- Give photos gentle `motion` (`zoom-in`, amount 0.2–0.4), not videos.
- Use few transitions: mostly cuts. Use `fade` or `black` (0.3–0.6 s) at section changes.
- **Text:** Swiss grotesk for titles (Inter Tight 700, letter_spacing −0.03, `mask-up`). Small, uppercase, widely tracked labels for location and date (Inter Tight 500, 0.14). Serif for emotional titles (Instrument Serif italic, `blur`). In 9:16, keep text out of the bottom ~22% and the right edge, where the Reels UI sits.
- Set `fade_out` to 2–3 s at the end.

## Example

```
replace_edit {
  scenes: [
    { beats: 8, cells: [{ asset_id: "a_1", in: 2 }], name: "open" },
    { beats: 4, cells: [{ asset_id: "a_2", motion: "zoom-in" }] },
    { beats: 8, cells: [
        { asset_id: "a_3", enter_beat: 0 },
        { asset_id: "a_4", enter_beat: 2, enter: "fade" },
        { asset_id: "a_5", enter_beat: 4, enter: "fade" } ],
      layouts: [{ format: "9:16", preset: "stack-3", weights: [1, 1.4, 1] }],
      transition: { kind: "fade", duration: 0.4 } }
  ]
}
add_text { text: "Korugöl", start: 0.6, duration: 3.5, font: "Inter Tight", weight: 700, anim_in: "mask-up",
           box: { format: "9:16", x: 0.5, y: 0.72, size: 130, align: "center" } }
```
