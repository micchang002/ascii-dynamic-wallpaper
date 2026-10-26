#!/usr/bin/env python3
"""Run an ASCII scene as a live desktop wallpaper (X11, GTK 3 + WebKit2GTK).

Opens one borderless desktop-type window per monitor, kept at the very bottom
of the stack, each showing index.html with a scene from scenes/. Desktop icons
(Ubuntu's Desktop Icons NG draws them in a transparent window) stay on top and
clickable; since that window takes the mouse, the global pointer is relayed to
the scene instead.

The chat box in the middle of the primary monitor is two layers: the page
draws the frosted glass panel, and a small transparent window above the desktop
icons (but below normal windows) holds native GTK controls. Enter opens the
prompt in Claude or ChatGPT in the default browser.

    ./wallpaper.py                     # the koi pond on every monitor
    ./wallpaper.py --scene delta       # the Delta Robotics Innovation Center
    ./wallpaper.py --scene delta,koi   # one scene per monitor, in order
    ./wallpaper.py --koi 9 --fps 30    # tune the pond
    ./wallpaper.py --monitor 1         # one monitor only
    ./wallpaper.py --cycle 120         # preview a whole day in two minutes
    ./wallpaper.py --ai chatgpt        # chat box opens ChatGPT by default
    ./wallpaper.py --no-chat           # just the pond
    ./wallpaper.py --window            # ordinary window, for trying it out
    ./wallpaper.py --install           # start automatically at login
"""
import argparse
import ctypes
import ctypes.util
import json
import pathlib
import shutil
import signal
import subprocess
import sys
import threading
import time
from urllib.parse import quote, urlencode

import cairo
import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
try:
    gi.require_version("WebKit2", "4.1")
except ValueError:
    gi.require_version("WebKit2", "4.0")
from gi.repository import Gdk, Gio, GLib, Gtk, WebKit2  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
AUTOSTART = pathlib.Path.home() / ".config/autostart/ascii-koi.desktop"
SETTINGS = pathlib.Path.home() / ".config/ascii-koi/settings.json"
POLL_MS = 40
RELOWER_S = 5
# Must match --chat-w / --chat-h in core/chat.css.
CHAT_W, CHAT_H = 640, 136
# Every scenes/<name>.js is a scene.
SCENES = sorted(p.stem for p in (HERE / "scenes").glob("*.js"))
# Scenes whose look follows the clock (they call setTheme by hour); the chat controls
# follow the same hours. Everything else is dark.
CLOCK_THEMED = {"koi"}
# Scenes without a chat box (they return chat: false).
NO_CHAT = {"delta"}


class XPointer:
    """Global pointer state straight from Xlib, plus whether it is over the desktop."""

    BUTTON1 = 1 << 8

    def __init__(self):
        c = ctypes
        x11 = c.cdll.LoadLibrary(c.util.find_library("X11"))
        x11.XOpenDisplay.restype = c.c_void_p
        x11.XOpenDisplay.argtypes = [c.c_char_p]
        x11.XDefaultRootWindow.restype = c.c_ulong
        x11.XDefaultRootWindow.argtypes = [c.c_void_p]
        x11.XInternAtom.restype = c.c_ulong
        x11.XInternAtom.argtypes = [c.c_void_p, c.c_char_p, c.c_int]
        x11.XQueryPointer.argtypes = [c.c_void_p, c.c_ulong, c.POINTER(c.c_ulong), c.POINTER(c.c_ulong)] + [
            c.POINTER(c.c_int)
        ] * 4 + [c.POINTER(c.c_uint)]
        x11.XGetWindowProperty.argtypes = [
            c.c_void_p, c.c_ulong, c.c_ulong, c.c_long, c.c_long, c.c_int, c.c_ulong,
            c.POINTER(c.c_ulong), c.POINTER(c.c_int), c.POINTER(c.c_ulong), c.POINTER(c.c_ulong),
            c.POINTER(c.POINTER(c.c_ubyte)),
        ]
        x11.XFree.argtypes = [c.c_void_p]
        self.x11 = x11
        self.dpy = x11.XOpenDisplay(None)
        if not self.dpy:
            raise RuntimeError("cannot open X display")
        self.root = x11.XDefaultRootWindow(self.dpy)
        self.type_atom = x11.XInternAtom(self.dpy, b"_NET_WM_WINDOW_TYPE", False)
        self.desktop_atom = x11.XInternAtom(self.dpy, b"_NET_WM_WINDOW_TYPE_DESKTOP", False)
        self.is_desktop_cache = {}

    def query(self):
        """(x, y, button1 held, over the desktop) in screen pixels."""
        c = ctypes
        root, child = c.c_ulong(), c.c_ulong()
        rx, ry, wx, wy, mask = c.c_int(), c.c_int(), c.c_int(), c.c_int(), c.c_uint()
        self.x11.XQueryPointer(
            self.dpy, self.root, c.byref(root), c.byref(child),
            c.byref(rx), c.byref(ry), c.byref(wx), c.byref(wy), c.byref(mask),
        )
        return rx.value, ry.value, bool(mask.value & self.BUTTON1), self.is_desktop(child.value)

    def is_desktop(self, window):
        if not window:
            return True
        cached = self.is_desktop_cache.get(window)
        if cached is not None:
            return cached
        c = ctypes
        actual_type, actual_format = c.c_ulong(), c.c_int()
        nitems, after = c.c_ulong(), c.c_ulong()
        prop = c.POINTER(c.c_ubyte)()
        status = self.x11.XGetWindowProperty(
            self.dpy, window, self.type_atom, 0, 16, False, 0,
            c.byref(actual_type), c.byref(actual_format), c.byref(nitems), c.byref(after), c.byref(prop),
        )
        result = False
        if status == 0 and prop:
            if actual_format.value == 32:
                atoms = c.cast(prop, c.POINTER(c.c_ulong))
                result = any(atoms[i] == self.desktop_atom for i in range(nitems.value))
            self.x11.XFree(prop)
        if len(self.is_desktop_cache) > 512:
            self.is_desktop_cache.clear()
        self.is_desktop_cache[window] = result
        return result


class ClaudePaster:
    """Pastes the prompt into Claude once its browser tab is the focused window.

    claude.ai shows a caution banner for any link that prefills a prompt, so the prompt goes
    on the clipboard and Ctrl+V is pressed (via XTest) when the tab is ready. It never presses
    Enter: sending stays with the user.
    """

    BROWSERS = ("Firefox", "Chrome", "Chromium", "Brave", "Edge", "Opera", "Vivaldi")
    POLL_MS = 200
    MIN_WAIT_S = 2.0  # let the new tab open, so an older Claude tab isn't pasted into
    SETTLE_S = 1.2  # title stable this long: the page and its message box have loaded
    TIMEOUT_S = 20
    XK_CONTROL_L, XK_V = 0xFFE3, 0x0076

    def __init__(self):
        c = ctypes
        x11 = c.cdll.LoadLibrary(c.util.find_library("X11"))
        xtst = c.cdll.LoadLibrary(c.util.find_library("Xtst"))
        x11.XOpenDisplay.restype = c.c_void_p
        x11.XOpenDisplay.argtypes = [c.c_char_p]
        x11.XDefaultRootWindow.restype = c.c_ulong
        x11.XDefaultRootWindow.argtypes = [c.c_void_p]
        x11.XInternAtom.restype = c.c_ulong
        x11.XInternAtom.argtypes = [c.c_void_p, c.c_char_p, c.c_int]
        x11.XKeysymToKeycode.restype = c.c_ubyte
        x11.XKeysymToKeycode.argtypes = [c.c_void_p, c.c_ulong]
        x11.XGetWindowProperty.argtypes = [
            c.c_void_p, c.c_ulong, c.c_ulong, c.c_long, c.c_long, c.c_int, c.c_ulong,
            c.POINTER(c.c_ulong), c.POINTER(c.c_int), c.POINTER(c.c_ulong), c.POINTER(c.c_ulong),
            c.POINTER(c.POINTER(c.c_ubyte)),
        ]
        x11.XFree.argtypes = [c.c_void_p]
        x11.XFlush.argtypes = [c.c_void_p]
        xtst.XTestFakeKeyEvent.argtypes = [c.c_void_p, c.c_uint, c.c_int, c.c_ulong]
        self.x11, self.xtst = x11, xtst
        self.dpy = x11.XOpenDisplay(None)
        self.root = x11.XDefaultRootWindow(self.dpy)
        self.active_atom = x11.XInternAtom(self.dpy, b"_NET_ACTIVE_WINDOW", False)
        self.name_atom = x11.XInternAtom(self.dpy, b"_NET_WM_NAME", False)
        self.ctrl = x11.XKeysymToKeycode(self.dpy, self.XK_CONTROL_L)
        self.v = x11.XKeysymToKeycode(self.dpy, self.XK_V)

    def _property(self, window, atom, length=1024):
        c = ctypes
        actual_type, actual_format = c.c_ulong(), c.c_int()
        nitems, after = c.c_ulong(), c.c_ulong()
        prop = c.POINTER(c.c_ubyte)()
        status = self.x11.XGetWindowProperty(
            self.dpy, window, atom, 0, length, False, 0,
            c.byref(actual_type), c.byref(actual_format), c.byref(nitems), c.byref(after), c.byref(prop),
        )
        if status != 0 or not prop:
            return None, 0
        if actual_format.value == 32:
            data = [c.cast(prop, c.POINTER(c.c_ulong))[i] for i in range(nitems.value)]
        else:
            data = c.string_at(prop, nitems.value * actual_format.value // 8)
        self.x11.XFree(prop)
        return data, actual_format.value

    def active_title(self):
        windows, _ = self._property(self.root, self.active_atom, 1)
        if not windows or not windows[0]:
            return ""
        name, fmt = self._property(windows[0], self.name_atom)
        return name.decode("utf-8", "replace") if fmt == 8 and name else ""

    def paste(self):
        for down in (True, False):
            keys = (self.ctrl, self.v) if down else (self.v, self.ctrl)
            for key in keys:
                self.xtst.XTestFakeKeyEvent(self.dpy, key, down, 0)
        self.x11.XFlush(self.dpy)

    def paste_when_ready(self, on_done):
        started = GLib.get_monotonic_time()
        ready = {"title": None, "since": 0}

        def tick():
            now = GLib.get_monotonic_time()
            elapsed = (now - started) / 1e6
            if elapsed > self.TIMEOUT_S:
                on_done(False)
                return False
            title = self.active_title()
            if "Claude" not in title or not any(b in title for b in self.BROWSERS):
                ready["title"] = None
                return True
            if title != ready["title"]:
                ready["title"], ready["since"] = title, now
                return True
            if elapsed >= self.MIN_WAIT_S and (now - ready["since"]) / 1e6 >= self.SETTLE_S:
                self.paste()
                on_done(True)
                return False
            return True

        GLib.timeout_add(self.POLL_MS, tick)


class Stats:
    """CPU, memory and GPU readings for scenes that show them (window.wallpaperStats).

    Sampled on a background thread every second, since nvidia-smi takes a moment to answer.
    """

    INTERVAL_S = 1.0
    GPU_QUERY = "name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw"

    def __init__(self):
        self.latest = None
        self._prev_cpu = None
        self._cpu_temp_path = self._find_cpu_temp()
        self._nvidia_smi = shutil.which("nvidia-smi")
        threading.Thread(target=self._loop, daemon=True).start()

    @staticmethod
    def _find_cpu_temp():
        for hwmon in sorted(pathlib.Path("/sys/class/hwmon").glob("hwmon*")):
            try:
                if (hwmon / "name").read_text().strip() in ("coretemp", "k10temp", "zenpower"):
                    return hwmon / "temp1_input"
            except OSError:
                continue
        return None

    def _loop(self):
        while True:
            try:
                self.latest = self._sample()
            except Exception as e:  # keep the wallpaper running whatever a sensor does
                print(f"stats: {e}", file=sys.stderr)
            time.sleep(self.INTERVAL_S)

    def _cpu(self):
        # Per line of /proc/stat: (idle + iowait, total) jiffies; the first line is all CPUs.
        times = []
        for line in pathlib.Path("/proc/stat").read_text().splitlines():
            if not line.startswith("cpu"):
                break
            v = [int(x) for x in line.split()[1:9]]
            times.append((v[3] + v[4], sum(v)))
        prev, self._prev_cpu = self._prev_cpu, times
        if not prev:
            return 0.0, [0.0] * (len(times) - 1)
        usage = [
            100 * (1 - (i1 - i0) / (t1 - t0)) if t1 > t0 else 0.0
            for (i0, t0), (i1, t1) in zip(prev, times)
        ]
        return usage[0], usage[1:]

    def _gpu(self):
        if not self._nvidia_smi:
            return None
        out = subprocess.run(
            [self._nvidia_smi, f"--query-gpu={self.GPU_QUERY}", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3,
        ).stdout.splitlines()
        if not out:
            return None
        name, *values = [v.strip() for v in out[0].split(",")]

        def num(v):
            try:
                return float(v)
            except ValueError:
                return None

        util, temp, used, total, power = (num(v) for v in values)
        return {
            "name": name, "util": util or 0.0, "temp": temp,
            "memUsed": (used or 0) / 1024, "memTotal": (total or 1) / 1024, "power": power,
        }

    def _sample(self):
        total, cores = self._cpu()
        temp = None
        if self._cpu_temp_path:
            try:
                temp = int(self._cpu_temp_path.read_text()) / 1000
            except (OSError, ValueError):
                pass
        mem = {}
        for line in pathlib.Path("/proc/meminfo").read_text().splitlines():
            key, value = line.split(":", 1)
            mem[key] = int(value.split()[0])
        return {
            "cpu": {"total": total, "cores": cores, "temp": temp},
            "mem": {"used": (mem["MemTotal"] - mem["MemAvailable"]) / 2**20, "total": mem["MemTotal"] / 2**20},
            "gpu": self._gpu(),
            "load": [float(x) for x in pathlib.Path("/proc/loadavg").read_text().split()[:3]],
            "uptime": float(pathlib.Path("/proc/uptime").read_text().split()[0]),
        }


def make_view(uri):
    view = WebKit2.WebView()
    view.get_settings().set_allow_file_access_from_file_urls(True)
    view.load_uri(uri)
    return view


def run_js(view, script):
    if hasattr(view, "evaluate_javascript"):
        view.evaluate_javascript(script, -1, None, None, None, None, None)
    else:
        view.run_javascript(script, None, None, None)


class Pond:
    """One desktop-type window covering a monitor."""

    def __init__(self, monitor, uri):
        self.geometry = monitor.get_geometry()
        self.scale = monitor.get_scale_factor()
        self.view = make_view(uri)
        self.sent = None

        g = self.geometry
        self.win = win = Gtk.Window()
        win.set_type_hint(Gdk.WindowTypeHint.DESKTOP)
        win.set_decorated(False)
        win.set_skip_taskbar_hint(True)
        win.set_skip_pager_hint(True)
        win.set_accept_focus(False)
        win.set_keep_below(True)
        win.stick()
        win.set_size_request(g.width, g.height)
        win.move(g.x, g.y)
        win.add(self.view)
        win.show_all()
        win.move(g.x, g.y)
        self.lower()

    def lower(self):
        """Sink below the desktop-icons window, which is a desktop-type window too."""
        gdk_window = self.win.get_window()
        if gdk_window:
            gdk_window.lower()

    def relay(self, x, y, over_desktop, clicked):
        g = self.geometry
        x, y = x / self.scale - g.x, y / self.scale - g.y
        active = over_desktop and 0 <= x < g.width and 0 <= y < g.height
        state = (round(x), round(y), active) if active else None
        if state == self.sent and not (clicked and active):
            return
        self.sent = state
        flag = lambda b: "true" if b else "false"  # noqa: E731
        run_js(self.view, f"window.wallpaperInput && wallpaperInput({x:.0f}, {y:.0f}, {flag(active)}, {flag(clicked and active)})")


class ChatOverlay:
    """Transparent window over the glass panel, holding native GTK chat controls.

    GTK widgets (not a second WebKit view) because WebKitGTK doesn't clear its transparent
    areas on X11: typed text and the AI toggle smeared over each other.
    """

    SITES = {"claude": "Claude", "chatgpt": "ChatGPT"}
    PLACEHOLDER = "How can I help you today?"
    # Clear, colourless glass controls: almost no fill, a bright rim and a top sheen,
    # so the frosted pond (drawn by the page underneath) shows straight through.
    CSS = b"""
    .koi-chat { background: transparent; }
    .koi-chat * { text-shadow: none; -gtk-icon-shadow: none; outline-width: 0; }
    .koi-chat entry {
        background: transparent; background-image: none; border: none; box-shadow: none;
        color: rgba(255, 255, 255, 0.94); caret-color: white; font-size: 16px; padding: 0; min-height: 0;
    }
    .koi-chat .pick {
        border-radius: 999px; padding: 3px;
        background-color: rgba(255, 255, 255, 0.02);
        background-image: linear-gradient(to bottom, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0));
        border: 1px solid rgba(255, 255, 255, 0.3);
        box-shadow: inset 0 1px rgba(255, 255, 255, 0.3);
    }
    .koi-chat .pick button {
        background: transparent; background-image: none; border: 1px solid transparent; box-shadow: none;
        border-radius: 999px; padding: 4px 13px; min-height: 0; min-width: 0;
        color: rgba(255, 255, 255, 0.6); font-size: 13px; font-weight: 600;
    }
    .koi-chat .pick button:hover { color: rgba(255, 255, 255, 0.9); }
    .koi-chat .pick button:checked, .koi-chat .send {
        color: white;
        background-color: rgba(255, 255, 255, 0.06);
        background-image: linear-gradient(to bottom, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.02) 55%, rgba(255, 255, 255, 0.1));
        border: 1px solid rgba(255, 255, 255, 0.7);
        box-shadow: inset 0 1px rgba(255, 255, 255, 0.8), inset 0 -1px rgba(255, 255, 255, 0.25), 0 2px 8px rgba(0, 0, 0, 0.12);
    }
    .koi-chat .send {
        border-radius: 13px; min-width: 36px; min-height: 36px; padding: 0;
        font-size: 18px; font-weight: 700;
    }
    .koi-chat .send:hover { background-color: rgba(255, 255, 255, 0.14); }
    .koi-chat .send:disabled { opacity: 0.45; }
    .koi-chat.light entry { color: rgba(28, 30, 34, 0.92); caret-color: #1c1e22; }
    .koi-chat.light .pick { background-color: rgba(255, 255, 255, 0.04); border-color: rgba(255, 255, 255, 0.9); }
    .koi-chat.light .pick button { color: rgba(28, 30, 34, 0.55); }
    .koi-chat.light .pick button:hover { color: rgba(28, 30, 34, 0.85); }
    .koi-chat.light .pick button:checked, .koi-chat.light .send {
        color: rgba(28, 30, 34, 0.92);
        background-color: rgba(255, 255, 255, 0.12);
        background-image: linear-gradient(to bottom, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0.04) 55%, rgba(255, 255, 255, 0.2));
        border-color: white;
    }
    """

    def __init__(self, monitor, ai, clock_theme=True, hour=None, cycle=None):
        self.clock_theme = clock_theme
        self.hour, self.cycle, self.started = hour, cycle, GLib.get_monotonic_time()
        self.paster = ClaudePaster()
        self.ai = load_settings().get("ai", ai)
        if self.ai not in self.SITES:
            self.ai = "claude"

        g = monitor.get_geometry()
        self.win = win = Gtk.Window(title="koi chat")
        win.set_decorated(False)
        win.set_skip_taskbar_hint(True)
        win.set_skip_pager_hint(True)
        win.set_keep_below(True)  # above the desktop icons, below everything else
        win.stick()
        win.set_app_paintable(True)
        visual = win.get_screen().get_rgba_visual()
        if visual:
            win.set_visual(visual)
        win.connect("draw", self.on_draw)
        win.get_style_context().add_class("koi-chat")
        css = Gtk.CssProvider()
        css.load_from_data(self.CSS)
        Gtk.StyleContext.add_provider_for_screen(win.get_screen(), css, Gtk.STYLE_PROVIDER_PRIORITY_USER)
        # Subpixel (coloured) font smoothing fringes badly on a transparent window.
        fonts = cairo.FontOptions()
        fonts.set_antialias(cairo.ANTIALIAS_GRAY)
        win.get_screen().set_font_options(fonts)

        # Same padding as #chat in chat.css, so the controls sit inside the glass.
        layout = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        layout.set_margin_top(18)
        layout.set_margin_bottom(14)
        layout.set_margin_start(22)
        layout.set_margin_end(18)

        self.entry = Gtk.Entry(placeholder_text=self.PLACEHOLDER, has_frame=False, hexpand=True)
        self.entry.connect("activate", self.submit)
        self.entry.connect("changed", self.on_changed)
        layout.pack_start(self.entry, True, True, 0)

        row = Gtk.Box(spacing=0)
        pick = Gtk.Box(spacing=4)
        pick.get_style_context().add_class("pick")
        self.picks = {}
        for name, label in self.SITES.items():
            button = Gtk.ToggleButton(label=label, relief=Gtk.ReliefStyle.NONE, can_focus=False)
            button.connect("toggled", self.on_pick, name)
            pick.pack_start(button, False, False, 0)
            self.picks[name] = button
        pick_wrap = Gtk.Box()
        pick_wrap.pack_start(pick, False, False, 0)
        row.pack_start(pick_wrap, False, False, 0)
        self.send = Gtk.Button(label="↑", can_focus=False)
        self.send.get_style_context().add_class("send")
        self.send.connect("clicked", self.submit)
        row.pack_end(self.send, False, False, 0)
        layout.pack_start(row, False, False, 0)
        win.add(layout)

        self.choose(self.ai)
        self.on_changed()
        self.update_theme()
        GLib.timeout_add(500 if cycle else 30000, self.update_theme)

        win.set_size_request(CHAT_W, CHAT_H)
        win.set_resizable(False)
        x, y = g.x + (g.width - CHAT_W) // 2, g.y + (g.height - CHAT_H) // 2
        win.move(x, y)
        win.show_all()
        win.move(x, y)

    @staticmethod
    def on_draw(_widget, cr):
        cr.set_operator(cairo.OPERATOR_SOURCE)
        cr.set_source_rgba(0, 0, 0, 0)
        cr.paint()
        cr.set_operator(cairo.OPERATOR_OVER)
        return False

    def current_hour(self):
        now = GLib.DateTime.new_now_local()
        clock = self.hour if self.hour is not None else now.get_hour() + now.get_minute() / 60
        if not self.cycle:
            return clock
        elapsed = (GLib.get_monotonic_time() - self.started) / 1e6
        return (clock + elapsed / self.cycle * 24) % 24

    def update_theme(self):
        """Dark text while the koi pond is milk-white (same hours as scenes/koi.js)."""
        hour = self.current_hour()
        context = self.win.get_style_context()
        if self.clock_theme and 8.5 <= hour < 18:
            context.add_class("light")
        else:
            context.remove_class("light")
        return True

    def choose(self, name):
        self.ai = name
        for key, button in self.picks.items():
            button.handler_block_by_func(self.on_pick)
            button.set_active(key == name)
            button.handler_unblock_by_func(self.on_pick)
        save_settings({"ai": name})

    def on_pick(self, button, name):
        self.choose(name)

    def on_changed(self, *_):
        self.send.set_sensitive(bool(self.entry.get_text().strip()))

    def submit(self, *_):
        prompt = self.entry.get_text().strip()
        if not prompt:
            return
        if self.ai == "chatgpt":
            Gio.AppInfo.launch_default_for_uri(f"https://chatgpt.com/?q={quote(prompt)}", None)
        else:
            # claude.ai warns about any prefilled-prompt link, so hand the prompt over by paste.
            clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
            clipboard.set_text(prompt, -1)
            clipboard.store()
            Gio.AppInfo.launch_default_for_uri("https://claude.ai/new", None)
            self.entry.set_placeholder_text("Opening Claude…")
            self.paster.paste_when_ready(self.on_pasted)
        self.entry.set_text("")

    def on_pasted(self, ok):
        if ok:
            self.reset_placeholder()
        else:
            self.entry.set_placeholder_text("Copied. Paste it into Claude with Ctrl+V")
            GLib.timeout_add_seconds(8, self.reset_placeholder)

    def reset_placeholder(self):
        self.entry.set_placeholder_text(self.PLACEHOLDER)
        return False


def load_settings():
    try:
        return json.loads(SETTINGS.read_text())
    except (OSError, ValueError):
        return {}


def save_settings(values):
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS.write_text(json.dumps({**load_settings(), **values}))


def install(args):
    flags = f"--scene {','.join(args.scene)} --koi {args.koi} --pads {args.pads} --fps {args.fps} --ai {args.ai}"
    if args.no_chat:
        flags += " --no-chat"
    if args.monitor is not None:
        flags += f" --monitor {args.monitor}"
    AUTOSTART.parent.mkdir(parents=True, exist_ok=True)
    AUTOSTART.write_text(
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=ASCII Wallpaper\n"
        f"Exec={sys.executable} {HERE / 'wallpaper.py'} {flags}\n"
        "X-GNOME-Autostart-enabled=true\n"
    )
    print(f"Installed {AUTOSTART}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)

    def scene_list(value):
        names = [n.strip() for n in value.split(",") if n.strip()]
        unknown = [n for n in names if n not in SCENES]
        if not names or unknown:
            raise argparse.ArgumentTypeError(f"choose from: {', '.join(SCENES)}")
        return names

    parser.add_argument("--scene", type=scene_list, default=["koi"],
                        help=f"scene, or a comma list (one per monitor): {', '.join(SCENES)} (default koi)")
    parser.add_argument("--koi", type=int, default=7, help="number of koi (default 7)")
    parser.add_argument("--pads", type=int, default=5, help="number of lily pads (default 5)")
    parser.add_argument("--fps", type=int, default=24, help="frame cap; lower saves CPU (default 24)")
    parser.add_argument("--monitor", type=int, help="only this monitor index")
    parser.add_argument("--hour", type=float, help="pin the time of day (0-24) instead of following the clock")
    parser.add_argument("--cycle", type=float, help="run a whole day in this many seconds (preview)")
    parser.add_argument("--ai", choices=["claude", "chatgpt"], default="claude", help="chat box default (default claude)")
    parser.add_argument("--no-chat", action="store_true", help="hide the chat box")
    parser.add_argument("--window", action="store_true", help="show in a normal window instead")
    parser.add_argument("--install", action="store_true", help="add a login autostart entry and exit")
    args = parser.parse_args()

    if args.install:
        install(args)
        return

    query = {"koi": args.koi, "pads": args.pads, "fps": args.fps, "ai": args.ai}
    if args.hour is not None:
        query["hour"] = args.hour
    if args.cycle:
        query["cycle"] = args.cycle

    def page(scene, chat):
        chat = "off" if args.no_chat else chat
        return f"{(HERE / 'index.html').as_uri()}?{urlencode({**query, 'scene': scene, 'chat': chat})}"

    if args.window:
        win = Gtk.Window(title="ascii wallpaper")
        win.set_default_size(1280, 720)
        view = make_view(page(args.scene[0], "full"))
        win.add(view)
        views = [view]
        win.connect("destroy", Gtk.main_quit)
        win.show_all()
    else:
        display = Gdk.Display.get_default()
        indices = range(display.get_n_monitors())
        if args.monitor is not None:
            indices = [args.monitor]
        primary = display.get_primary_monitor() or display.get_monitor(0)
        chat_on = [display.get_monitor(i) == primary for i in indices]
        if not any(chat_on):
            chat_on[0] = True
        scenes = [args.scene[n % len(args.scene)] for n in range(len(indices))]
        ponds = [
            Pond(display.get_monitor(i), page(scene, "glass" if on else "off"))
            for i, scene, on in zip(indices, scenes, chat_on)
        ]
        views = [pond.view for pond in ponds]
        n = chat_on.index(True)
        if not args.no_chat and scenes[n] not in NO_CHAT:
            overlay = ChatOverlay(  # noqa: F841
                display.get_monitor(indices[n]), args.ai, scenes[n] in CLOCK_THEMED, args.hour, args.cycle
            )

        # Re-sink now and then, e.g. after the desktop-icons extension restarts.
        def relower():
            for pond in ponds:
                pond.lower()
            return True

        GLib.timeout_add_seconds(RELOWER_S, relower)

        pointer = XPointer()
        was_pressed = False

        def poll():
            nonlocal was_pressed
            x, y, pressed, over_desktop = pointer.query()
            clicked = pressed and not was_pressed
            was_pressed = pressed
            for pond in ponds:
                pond.relay(x, y, over_desktop, clicked)
            return True

        GLib.timeout_add(POLL_MS, poll)

    stats = Stats()

    def push_stats():
        if stats.latest:
            script = f"window.wallpaperStats && wallpaperStats({json.dumps(stats.latest)})"
            for view in views:
                run_js(view, script)
        return True

    GLib.timeout_add(1000, push_stats)

    signal.signal(signal.SIGINT, signal.SIG_DFL)
    Gtk.main()


if __name__ == "__main__":
    main()
