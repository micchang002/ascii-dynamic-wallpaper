# ascii wallpaper

Live desktop wallpapers drawn as ASCII on a canvas. There's no build step and there are no dependencies.
Inspired by [stackedlol/ascii-sharks](https://github.com/stackedlol/ascii-sharks).

## Scenes

**`koi`**: a koi pond.
- Koi in seven varieties swim with flowing fins and leave glowing wakes.
- Lily pads and lotus flowers drift on the surface, and raindrops make ripples.
- The colours follow the clock: dark at night, violet and peach at dawn, milk-white with koi shadows by
  day, and amber at sunset.
- Click to drop food. If you hold the cursor still, nearby koi drift towards it.
- Params: `koi=7`, `pads=5`, `hour=13.5` (fix the time of day), `cycle=120` (a whole day in 120 seconds).

**`delta`**: DRIC, the Delta Robotics Innovation Center, in a coder's style.
- A plain black background with a dim ground line.
- In the upper middle, the Delta mark (triangle, orbit and nucleus) and a DRIC wordmark in Delta's letterforms,
  written in sparse, slowly scrolling code. Its colours drift in a gradient that follows the time of day: pink and
  peach at dawn, blues and greens in the morning, Delta blue and cyan at noon, gold in the afternoon, orange and
  magenta at sunset, and violet at night. A light sweeps over it, the cursor scrambles it, and a click glitches it.
  Params: `hour=13.5` (fix the time of day), `cycle=120` (a whole day in 120 seconds).
- A UR5 arm on a floor rail rearranges the wordmark. Every so often it picks up a letter, parks it below the
  word, moves another letter into its place, then drops the first into the gap. The other letters slide to make
  room, and the next round puts them back, so the word reads DRIC most of the time. Click a letter to have it
  swapped. Click anywhere else and, when its gripper is empty, the arm reaches there. It doesn't follow the cursor.
  The rail position, joint angles, gripper position and current swap are shown underneath.
- A `sysmon --watch` terminal in the top-right shows live CPU (total, per core, history, temperature), memory
  and NVIDIA GPU stats (use, temperature, VRAM, power), plus load and uptime. `wallpaper.py` reads these from
  `/proc` and `nvidia-smi`, because a web page can't. In a plain browser the panel waits for data.
- No chat box.

The koi scene has a liquid-glass chat box in the middle. Type a prompt and press Enter to open it in
[Claude](https://claude.ai) or [ChatGPT](https://chatgpt.com). The toggle picks which one, and your last choice
is remembered. ChatGPT opens with your prompt already filled in. Claude warns about any link that fills in a
prompt, as a guard against malicious links. So for Claude, the wallpaper copies your prompt, opens a new chat,
and pastes it in once the tab has loaded. It doesn't press Enter, so you review and send. In a plain browser
tab the prompt is only copied, and you paste it with Ctrl+V.

## Try it

Open `index.html?scene=delta` (or `?scene=koi`) in a browser. Common params: `fps=30`, `chat=off`.

## Use as a wallpaper (Linux, X11)

Needs GTK 3 and WebKit2GTK. These are already installed on Ubuntu GNOME; otherwise run
`sudo apt install gir1.2-webkit2-4.1`.

```sh
./wallpaper.py                    # koi pond on every monitor, behind all windows
./wallpaper.py --scene delta      # Delta Robotics Innovation Center
./wallpaper.py --scene delta,koi  # one scene per monitor, in order
./wallpaper.py --window           # preview in a normal window
./wallpaper.py --fps 20           # lighter on CPU
./wallpaper.py --cycle 120        # preview a whole day in two minutes (koi colours, DRIC logo colours)
./wallpaper.py --ai chatgpt       # chat box starts on ChatGPT
./wallpaper.py --no-chat          # no chat box
./wallpaper.py --install          # autostart at login with these options (~/.config/autostart/ascii-koi.desktop)
```

Stop it with Ctrl+C, or `pkill -f wallpaper.py`.

The system monitor in `delta` needs nothing extra. It uses only Python's standard library:
- **CPU and memory:** read from `/proc`, which every Linux system has.
- **CPU temperature:** read from the kernel's sensor driver (`coretemp` for Intel, `k10temp` for AMD), which is
  usually loaded already. If there's no driver, the temperature is left blank.
- **GPU:** read with `nvidia-smi`, which comes with the NVIDIA driver. Without an NVIDIA GPU and driver, the panel
  shows "no NVIDIA GPU found" and everything else keeps working. AMD and Intel GPUs aren't read yet.

Desktop icons and folders stay on top of the scene, and you can still click, open and drag them.
Those icons sit in front of the scene and take the mouse clicks, so the launcher reads the cursor itself.
That keeps the scenes interactive. A click on an icon also counts as a click on the scene.

The chat box appears on the primary monitor. The page draws the glass panel, and a small transparent window
holds the text field. That window sits above the desktop icons and below your normal windows.

WebKitGTK draws the canvas in software. At 2560×1440 and the default 24 fps, each monitor uses about a
third of one CPU core. Use `--fps 15` to lower that.

On Windows, load `index.html?scene=…` in [Lively Wallpaper](https://www.rocksdanister.com/lively/).
On macOS, load it in [Plash](https://sindresorhus.com/plash).

## Layout

```
index.html        host page: canvas + chat box; loads core/ and then the scene
core/math.js      clamp, lerp, noise, …
core/grid.js      the ASCII cell grid: colours, glyph sprites, redraws only changed cells, frosted chat glass
core/shapes.js    circles, capsules, boxes, triangles drawn as shaded ASCII
core/app.js       loads scenes/<name>.js, runs the frame loop, routes mouse input
core/chat.js/css  the chat box
scenes/*.js       one file per wallpaper
wallpaper.py      Linux launcher (one window per monitor, input relay, native chat controls)
```

## Adding a scene

Create `scenes/<name>.js`. It's picked up by `?scene=<name>` and `./wallpaper.py --scene <name>`, with no
registration needed:

```js
Wallpaper.scene("name", (api) => {
  const { grid, pointer, params, intParam, floatParam, setTheme } = api;
  const S = Wallpaper.shapes, style = Wallpaper.style;

  return {
    cellWidth: (W, H) => 10,             // optional: cell size in px
    resize() {},                          // grid.W/H/cw/ch/cols/rows changed
    paintBackdrop(ctx, W, H) {},          // optional: background behind the glyphs
    step(dt, t) {},                       // optional: simulation
    draw(t, dt) {                         // fill the grid for this frame
      grid.text(2, 2, "hello", style(255, 255, 255, 1));
      S.paint(grid, S.circle(200, 200, 60), { rgb: [0, 120, 210] });
    },
    pointerMove(x, y, moved) {},          // optional
    click(x, y) {},                       // optional
  };
});
```

If your scene changes between light and dark, call `setTheme("light" | "dark")` so the chat box matches.
Then add the scene's name to `CLOCK_THEMED` in `wallpaper.py`. To leave out the chat box, return
`chat: false` and add the name to `NO_CHAT` in `wallpaper.py`. `grid.put(c, r, glyph, style, bg)` can also
fill a cell's background, like highlighted text in a terminal. Under `wallpaper.py`, `api.stats.data` holds
the latest CPU, memory and GPU readings.
