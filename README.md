# ascii wallpaper

Animated desktop wallpapers drawn entirely in ASCII characters.
Inspired by [stackedlol/ascii-sharks](https://github.com/stackedlol/ascii-sharks).

| Scene | What it shows |
|-------|---------------|
| `koi` | A koi pond that follows the clock (dark at night, milk-white by day). Click to feed the fish. It also has a glass chat box that sends your prompt to Claude or ChatGPT. |
| `delta` | The DRIC logo on black, with colours that change through the day. A UR5 arm on a rail swaps the letters around; click a letter to swap it yourself. A live CPU/GPU monitor sits in the top-right. |

## Install (Linux)

You need Linux with X11 (Ubuntu GNOME works out of the box). Wayland isn't supported.

```sh
git clone https://github.com/micchang002/ascii-dynamic-wallpaper.git
cd ascii-dynamic-wallpaper
sudo apt install python3-gi gir1.2-webkit2-4.1   # usually already installed on Ubuntu
./wallpaper.py
```

To start it automatically when you log in:

```sh
./wallpaper.py --scene delta --install
```

To stop it, press Ctrl+C or run `pkill -f wallpaper.py`.

You don't need any extra packages for the system monitor. It reads `/proc` and uses `nvidia-smi` if you have an NVIDIA GPU; without one, the GPU rows are just left empty.

### Windows / macOS

Open `index.html?scene=koi` or `index.html?scene=delta` in [Lively Wallpaper](https://www.rocksdanister.com/lively/) (Windows) or [Plash](https://sindresorhus.com/plash) (macOS).
The system monitor only works with the Linux launcher.

## Options

```sh
./wallpaper.py --scene delta        # pick a scene (koi is the default)
./wallpaper.py --scene delta,koi    # one scene per monitor
./wallpaper.py --window             # preview in a normal window
./wallpaper.py --fps 15             # use less CPU (default 24)
./wallpaper.py --cycle 120          # play a whole day in 2 minutes
./wallpaper.py --ai chatgpt         # koi chat box opens ChatGPT instead of Claude
./wallpaper.py --no-chat            # hide the chat box
```

To try a scene in a browser, open `index.html?scene=delta`.

## Good to know

- Your desktop icons stay visible and clickable on top of the wallpaper.
- With Claude, the chat box copies your prompt and pastes it into a new chat for you. It doesn't send it, so you can check it first.
- Each monitor uses about a third of a CPU core at 1440p. Use `--fps 15` if that's too much.

## Adding your own scene

Create `scenes/<name>.js`, then run it with `./wallpaper.py --scene <name>`:

```js
Wallpaper.scene("name", ({ grid }) => ({
  resize() {},                 // the screen size changed
  step(dt, t) {},              // update your animation
  draw(t) {                    // draw this frame
    grid.text(2, 2, "hello", Wallpaper.style(255, 255, 255, 1));
  },
  click(x, y) {},              // optional
}));
```

`scenes/koi.js` and `scenes/delta.js` are full examples. The shared code is in `core/`:

| File | What it does |
|------|--------------|
| `grid.js` | The character grid |
| `shapes.js` | Shape helpers |
| `app.js` | The frame loop and mouse input |
