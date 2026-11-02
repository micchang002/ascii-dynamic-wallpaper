# ascii wallpaper

Animated desktop wallpapers drawn entirely in ASCII characters.
Inspired by [stackedlol/ascii-sharks](https://github.com/stackedlol/ascii-sharks).

| Scene | What it shows |
|-------|---------------|
| `koi` | A koi pond that follows the clock (dark at night, milk-white by day). Click to feed the fish. It also has a glass chat box that sends your prompt to Claude or ChatGPT. |
| `delta` | The DRIC logo on black, with colours that change through the day. A UR5 arm on a rail swaps the letters around; click a letter to swap it yourself. A live CPU/GPU monitor sits in the top-right. |
| `cats` | Playful ASCII cats across 3 selectable scenes (Living Room, Rooftop, Garden). Configure the number of cats (`--cats 3` or `?cats=3`), play with laser pointer and toys (yarn ball, wind-up mouse, treats), pet them to make them purr, and watch them leave paw prints on your desktop. Cats are drawn at koi scale with 22 poses (loaf, lying on the side, curled asleep, grooming, stretching, belly-up…); open `?scene=cats&pose=all` to see them all. No chat box. |
| `shore` | The koi pond and its grassy bank, all seen from above, with stones, reeds and cats (`--cats 3`). The cats watch koi that swim up to the bank, creep after them and swat at the water; the koi scatter, and sometimes one splashes the cat back. Cats also come to the edge to drink. Click the water to feed the koi (they crowd the bank, and the cats notice), click the bank to call a cat, rest the cursor on a cat to pet it. |
| `ocean` | Manta rays and humpback whales over a school of fish, drawn as small 3D bodies. Seen from above (`--view top`) or through the water from below (`--view side`); `--species mix`, `manta` or `whale` (whales bring a calf). Switch from the scene menu or with keys V / S (H shows a small switcher in the top-left). Mantas somersault through plankton you click into the water; whales rise to blow. Follows the clock. |
| `tank` | A goldfish aquarium: ryukin, oranda, black telescope-eye, ranchu, comet and shubunkin with flowing see-through tails. Click to sprinkle flakes; rest the cursor on the glass and the fish come to look at you. The lamp turns off at night. |
| `fireflies` | Fireflies over a meadow and a moonlit pond. They start out blinking at random and, over a minute, fall into step until the whole field flashes together (`?sync=60` sets how long). Click to flash a lantern and they answer in a spreading ring. |
| `microduck` | Little two-legged robot ducks (after Pollen Robotics' Microduck: loaf-shaped head with one camera eye, a flat bill that drops open, black servo neck and legs, chunky two-tone feet) in a playroom, in cream, sky, lavender and graphite. They waddle about, look at you, sit and doze, dance, chat in their own voices, roller-skate (and wipe out, then get back up), carry toys to the basket in their beaks, kick a ball around, recharge at the dock, and sometimes race. Move the cursor and they chase it like a laser dot; rest it on a duck to pet it; click a duck to boop it, anywhere else to drop a toy. `--ducks 4` or `?ducks=4`; open `?scene=microduck&pose=all` to see every colourway from several angles. |

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
./wallpaper.py --scene cats         # cats scene (or delta, koi, shore, ocean, tank, fireflies)
./wallpaper.py --scene shore --cats 2 # koi pond with 2 cats on the bank
./wallpaper.py --scene cats --cats 5 --env room # 5 cats in living room (or roof, garden)
./wallpaper.py --scene microduck --ducks 6 # six robot ducks
./wallpaper.py --scene ocean --view side --species whale # whales seen through the water
./wallpaper.py --scene delta,koi    # one scene per monitor
./wallpaper.py --size 1:597x336     # monitor 1's screen size in mm, if it reports a wrong one
./wallpaper.py --no-link            # koi stay on their own monitor
./wallpaper.py --window             # preview in a normal window
./wallpaper.py --fps 15             # use less CPU (default 24)
./wallpaper.py --cycle 120          # play a whole day in 2 minutes
./wallpaper.py --ai chatgpt         # koi chat box opens ChatGPT instead of Claude
./wallpaper.py --no-chat            # hide the chat box
```

To try a scene in a browser, open `index.html?scene=delta`.

### Scene menu

Click `≡` in the bottom-right corner to switch scenes (and options such as ocean's view and animals, or the cats' room). With `wallpaper.py`, each monitor remembers what you last picked and starts on it next time, unless you pass `--scene`. Add `?menu=0` to hide the button.

### Multiple monitors

`wallpaper.py` lays the monitors out as in your display settings, offsets included. Each monitor's size in mm comes from the monitor itself (EDID), so glyphs and animals are the same physical size on all of them, even when their resolutions differ. Where two monitors touch, animals swim from one to the next through the shared part of the edge, as if the monitors stood butted together at the middle of that edge: what is 1 mm past one edge is 1 mm inside the other. Koi, tank and ocean all do this. Koi treat the rest of the edge as a wall. The tank and the sea run on past it, so fish, mantas and whales swim off and in there as before. The tank links side by side only. The ocean also links up and down when seen from above, but only side by side in its side view. Monitors only link when they run the same scene with the same options (for example ocean's view and animals). The 3D scenes on touching monitors share one perspective, so a whale halfway across is drawn alike on both.

Linked monitors share one count for each kind of animal: together they hold the per-monitor number (`--koi`, the tank's fish, the ocean's mantas and whales) for every monitor, split by screen area, and each monitor stays within about one of its share. Animals cross only from the fuller side, and an over-full monitor sends one at a time towards the door. A whale cow takes her calf along. When a monitor joins or leaves (say you switch it to another scene), the others make up the difference: a koi rises from the deep or sinks out of sight, and fish, mantas and whales swim in or off through an edge with no neighbour. If a monitor reports no size or a wrong one, `wallpaper.py` prints a hint, and that monitor keeps the old screen-relative sizes until you give it one with `--size`.

To try it without Linux, serve the repo (`python3 -m http.server`) and open `http://localhost:8000/dev/screens.html`. It shows several monitors in one tab, drawn to scale, each labelled with what it holds and its share. Set them up with `?layout=1920x1080+0+0@3.62,2560x1440+1920+300@4.29` (size+x+y@px per mm, one per monitor) and pick a scene with `&scene=tank` or `&scene=ocean&view=side`.

## Good to know

- Your desktop icons stay visible and clickable on top of the wallpaper.
- With Claude, the chat box copies your prompt and pastes it into a new chat for you. It doesn't send it, so you can check it first.
- Scenes run at 24 fps by default, in the browser too (`?fps=30` to change it). Each monitor uses about a third of a CPU core at 1440p; use `--fps 15` if that's too much.
- With `wallpaper.py`, a monitor that's at least 70% covered by windows drops to 5 fps, and one with a maximized or fullscreen window (or 95% covered) pauses until it shows again. Minimized windows and other workspaces don't count.

## Adding your own scene

Create `scenes/<name>.js`, then run it with `./wallpaper.py --scene <name>`. To list it in the scene menu, add it to `SCENES` in `core/menu.js`.

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
| `menu.js` | The scene menu (bottom-right) |
| `solid.js` | Small 3D bodies drawn as ASCII (z-buffer, rims, spine chains); used by ocean and tank |
| `app.js` | The frame loop, mouse input, and the doors between monitors (`links`, `arrive`) |
