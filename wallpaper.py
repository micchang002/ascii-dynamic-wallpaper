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
    ./wallpaper.py --size 1:597x336    # monitor 1's screen in mm, if it reports none
    ./wallpaper.py --no-link           # koi stay on their own monitor
    ./wallpaper.py --cycle 120         # preview a whole day in two minutes
    ./wallpaper.py --ai chatgpt        # chat box opens ChatGPT by default
    ./wallpaper.py --no-chat           # just the pond
    ./wallpaper.py --window            # ordinary window, for trying it out
    ./wallpaper.py --install           # start automatically at login

The page's scene menu (bottom-right) switches scenes in place; each monitor
remembers its pick (in settings.json) for next time unless --scene is given.

Monitors are laid out as in the display settings. Each page learns its monitor's
pixels per mm (from EDID, or --size), so glyphs and animals are the same size on
every monitor; where two monitors running the same scene touch, koi swim across.
Linked monitors share one count: the group keeps --koi per monitor in all, spread
by area, and koi migrate (or rise and sink) to keep each monitor near its share.
"""
import argparse
import ctypes
import ctypes.util
import json
import math
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
CLOCK_THEMED = {"koi", "cats", "cat", "shore", "ocean"}
# Scenes without a chat box (they return chat: false).
NO_CHAT = {"delta", "cats", "ocean", "tank", "fireflies", "microduck"}
# What the page's scene menu sets (core/menu.js); remembered per monitor.
MENU_KEYS = {"scene", "view", "species", "env"}
# A monitor this much covered by windows pauses its scene; this much slows it to SLOW_FPS.
COVERED_PAUSE, COVERED_SLOW, SLOW_FPS = 0.95, 0.7, 5
COVERAGE_MS = 500
# Monitor edges this close (px) count as touching.
EDGE_SLACK = 2
OPPOSITE = {"l": "r", "r": "l", "t": "b", "b": "t"}
# Pixels per mm outside this range is a made-up EDID size (projectors and some TVs send one).
PXMM_RANGE = (1.2, 10)
# How often linked monitors' animal counts are checked against their group's total.
RECONCILE_MS = 1000


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


class Coverage:
    """Where the open app windows are, from the window manager's stacking list (EWMH).

    Minimized windows, windows on other workspaces, and desktop or keep-below windows
    (the wallpaper itself, desktop icons, the chat controls) don't count.
    """

    ALL_WORKSPACES = 0xFFFFFFFF

    def __init__(self):
        c = ctypes
        x11 = c.cdll.LoadLibrary(c.util.find_library("X11"))
        x11.XOpenDisplay.restype = c.c_void_p
        x11.XOpenDisplay.argtypes = [c.c_char_p]
        x11.XDefaultRootWindow.restype = c.c_ulong
        x11.XDefaultRootWindow.argtypes = [c.c_void_p]
        x11.XInternAtom.restype = c.c_ulong
        x11.XInternAtom.argtypes = [c.c_void_p, c.c_char_p, c.c_int]
        x11.XGetWindowProperty.argtypes = [
            c.c_void_p, c.c_ulong, c.c_ulong, c.c_long, c.c_long, c.c_int, c.c_ulong,
            c.POINTER(c.c_ulong), c.POINTER(c.c_int), c.POINTER(c.c_ulong), c.POINTER(c.c_ulong),
            c.POINTER(c.POINTER(c.c_ubyte)),
        ]
        x11.XGetGeometry.argtypes = [c.c_void_p, c.c_ulong, c.POINTER(c.c_ulong)] + [c.POINTER(c.c_int)] * 2 + [
            c.POINTER(c.c_uint)
        ] * 4
        x11.XTranslateCoordinates.argtypes = [c.c_void_p, c.c_ulong, c.c_ulong, c.c_int, c.c_int] + [
            c.POINTER(c.c_int)
        ] * 2 + [c.POINTER(c.c_ulong)]
        x11.XFree.argtypes = [c.c_void_p]
        self.x11 = x11
        self.dpy = x11.XOpenDisplay(None)
        if not self.dpy:
            raise RuntimeError("cannot open X display")
        self.root = x11.XDefaultRootWindow(self.dpy)

        def atom(name):
            return x11.XInternAtom(self.dpy, name.encode(), False)

        self.stacking = atom("_NET_CLIENT_LIST_STACKING")
        self.current_workspace = atom("_NET_CURRENT_DESKTOP")
        self.workspace = atom("_NET_WM_DESKTOP")
        self.type_atom = atom("_NET_WM_WINDOW_TYPE")
        self.app_types = {atom("_NET_WM_WINDOW_TYPE_NORMAL"), atom("_NET_WM_WINDOW_TYPE_DIALOG")}
        self.state = atom("_NET_WM_STATE")
        self.skip_states = {atom("_NET_WM_STATE_HIDDEN"), atom("_NET_WM_STATE_BELOW")}
        self.fullscreen = atom("_NET_WM_STATE_FULLSCREEN")
        self.maximized = {atom("_NET_WM_STATE_MAXIMIZED_VERT"), atom("_NET_WM_STATE_MAXIMIZED_HORZ")}
        self.frame_extents = atom("_NET_FRAME_EXTENTS")  # the window manager's title bar and borders
        self.gtk_frame_extents = atom("_GTK_FRAME_EXTENTS")  # client-side shadows, drawn inside the window

    def _property(self, window, atom, length=1024):
        """A 32-bit property as a list, or [] when it isn't set (or the window is gone)."""
        c = ctypes
        actual_type, actual_format = c.c_ulong(), c.c_int()
        nitems, after = c.c_ulong(), c.c_ulong()
        prop = c.POINTER(c.c_ubyte)()
        status = self.x11.XGetWindowProperty(
            self.dpy, window, atom, 0, length, False, 0,
            c.byref(actual_type), c.byref(actual_format), c.byref(nitems), c.byref(after), c.byref(prop),
        )
        if status != 0 or not prop:
            return []
        data = []
        if actual_format.value == 32:
            data = [c.cast(prop, c.POINTER(c.c_ulong))[i] for i in range(nitems.value)]
        self.x11.XFree(prop)
        return data

    def _rect(self, window):
        """(x0, y0, x1, y1) of the window's visible frame in screen pixels, or None."""
        c = ctypes
        root, x, y = c.c_ulong(), c.c_int(), c.c_int()
        w, h, border, depth = c.c_uint(), c.c_uint(), c.c_uint(), c.c_uint()
        if not self.x11.XGetGeometry(self.dpy, window, c.byref(root), c.byref(x), c.byref(y),
                                     c.byref(w), c.byref(h), c.byref(border), c.byref(depth)):
            return None
        child = c.c_ulong()
        if not self.x11.XTranslateCoordinates(self.dpy, window, self.root, 0, 0, c.byref(x), c.byref(y), c.byref(child)):
            return None
        x0, y0, x1, y1 = x.value, y.value, x.value + w.value, y.value + h.value
        frame = self._property(window, self.frame_extents, 4)
        if len(frame) == 4:
            x0, x1, y0, y1 = x0 - frame[0], x1 + frame[1], y0 - frame[2], y1 + frame[3]
        shadow = self._property(window, self.gtk_frame_extents, 4)
        if len(shadow) == 4:
            x0, x1, y0, y1 = x0 + shadow[0], x1 - shadow[1], y0 + shadow[2], y1 - shadow[3]
        return (x0, y0, x1, y1) if x0 < x1 and y0 < y1 else None

    def windows(self):
        """The visible app windows, as (rect, fills its monitor) with rect = (x0, y0, x1, y1).

        A maximized window leaves the top bar and dock showing, so it is flagged as filling
        the monitor instead of being measured.
        """
        current = self._property(self.root, self.current_workspace, 1)
        windows = []
        for window in self._property(self.root, self.stacking):
            types = self._property(window, self.type_atom, 16)
            if types and not self.app_types.intersection(types):
                continue
            states = set(self._property(window, self.state, 32))
            if self.skip_states & states:
                continue
            workspace = self._property(window, self.workspace, 1)
            if workspace and current and workspace[0] not in (self.ALL_WORKSPACES, current[0]):
                continue
            rect = self._rect(window)
            if rect:
                windows.append((rect, self.fullscreen in states or self.maximized <= states))
        return windows

    @staticmethod
    def fraction(windows, area):
        """How much of area (x0, y0, x1, y1) the windows cover, 0 to 1."""
        ax0, ay0, ax1, ay1 = area
        for (x0, y0, x1, y1), fills in windows:
            if fills and ax0 <= (x0 + x1) / 2 < ax1 and ay0 <= (y0 + y1) / 2 < ay1:
                return 1.0
        rects = [rect for rect, _ in windows]
        clipped = [
            (max(x0, ax0), max(y0, ay0), min(x1, ax1), min(y1, ay1)) for x0, y0, x1, y1 in rects
        ]
        clipped = [r for r in clipped if r[0] < r[2] and r[1] < r[3]]
        if not clipped:
            return 0.0
        # Sweep across the distinct x edges; in each strip, merge the covered y spans.
        xs = sorted({x for r in clipped for x in (r[0], r[2])})
        covered = 0
        for xa, xb in zip(xs, xs[1:]):
            spans = sorted((r[1], r[3]) for r in clipped if r[0] <= xa and r[2] >= xb)
            length, end = 0, None
            for y0, y1 in spans:
                if end is None or y0 >= end:
                    length, end = length + y1 - y0, y1
                elif y1 > end:
                    length, end = length + y1 - end, y1
            covered += (xb - xa) * length
        return covered / ((ax1 - ax0) * (ay1 - ay0))


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


def make_view(uri, on_message=None):
    """A WebView on uri. on_message(dict) gets what the page's scene menu posts
    (window.webkit.messageHandlers.wallpaper): the query of the scene it switches to."""
    manager = WebKit2.UserContentManager()
    if on_message:
        def received(_manager, result):
            value = result.get_js_value() if hasattr(result, "get_js_value") else result
            try:
                on_message(json.loads(value.to_string()))
            except ValueError:
                pass

        manager.connect("script-message-received::wallpaper", received)
        manager.register_script_message_handler("wallpaper")
    view = WebKit2.WebView.new_with_user_content_manager(manager)
    view.get_settings().set_allow_file_access_from_file_urls(True)
    view.load_uri(uri)
    return view


def run_js(view, script):
    if hasattr(view, "evaluate_javascript"):
        view.evaluate_javascript(script, -1, None, None, None, None, None)
    else:
        view.run_javascript(script, None, None, None)


def px_per_mm(monitor, size=None):
    """The monitor's logical px per mm, from its EDID size or size=(w, h) mm; None if unknown."""
    g = monitor.get_geometry()
    w_mm, h_mm = size or (monitor.get_width_mm(), monitor.get_height_mm())
    if w_mm <= 0 or h_mm <= 0:
        return None
    # Along the diagonal, so it doesn't matter whether a rotated monitor swaps its mm.
    pxmm = math.hypot(g.width, g.height) / math.hypot(w_mm, h_mm)
    return pxmm if PXMM_RANGE[0] <= pxmm <= PXMM_RANGE[1] else None


def doors(rects):
    """Where monitors (x, y, w, h) touch: for each, a list of (side, other, start, end), side
    being l / r / t / b and start..end the shared stretch along that edge in its own px."""
    found = [[] for _ in rects]
    for i, (ax, ay, aw, ah) in enumerate(rects):
        for j, (bx, by, bw, bh) in enumerate(rects):
            if i == j:
                continue
            across = max(ay, by), min(ay + ah, by + bh)
            down = max(ax, bx), min(ax + aw, bx + bw)
            for side, touches, (lo, hi), origin in (
                ("r", abs(ax + aw - bx) <= EDGE_SLACK, across, ay),
                ("l", abs(bx + bw - ax) <= EDGE_SLACK, across, ay),
                ("b", abs(ay + ah - by) <= EDGE_SLACK, down, ax),
                ("t", abs(by + bh - ay) <= EDGE_SLACK, down, ax),
            ):
                if touches and hi > lo:
                    found[i].append((side, j, lo - origin, hi - origin))
    return found


class Pond:
    """One desktop-type window covering a monitor."""

    def __init__(self, monitor, uri, on_message=None):
        self.geometry = monitor.get_geometry()
        self.scale = monitor.get_scale_factor()
        self.view = make_view(uri, on_message)
        self.sent = None
        self.throttled = None
        # px per mm, if known (the share of a linked group's animals goes by area in mm²).
        self.pxmm = None
        self.reset()
        self.on_change = None
        # A reloaded page (the scene menu switches scenes that way) starts at full speed again.
        self.view.connect("load-changed", self.on_load)

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

    def on_load(self, _view, event):
        if event == WebKit2.LoadEvent.COMMITTED:
            self.throttled = None
            self.reset()
            if self.on_change:
                self.on_change()

    def reset(self):
        """Forget the page: until the new one says it is up, it has no doors and no count."""
        # The scene, whether it takes arrivals, the options that must match a neighbour's
        # (its link key), its animals per monitor, and how many it holds now.
        self.scene, self.linkable, self.key = None, False, ""
        self.population, self.count = 0, None
        self.doors_sent = None

    def hear(self, values):
        """The page's own news: it is up, its link key changed, or its count did."""
        if "ready" in values:
            self.scene, self.linkable = values["ready"], bool(values.get("links"))
            population = values.get("population")
            self.population = population if isinstance(population, int) and population > 0 else 0
        if "key" in values:
            self.key = str(values["key"])
        if isinstance(values.get("count"), int):
            self.count = values["count"]
        if self.on_change:
            self.on_change()

    def area(self):
        g = self.geometry
        return g.width * g.height / (self.pxmm ** 2 if self.pxmm else 1)

    def populate(self, n):
        run_js(self.view, f"window.wallpaperPopulate && wallpaperPopulate({n})")

    def set_doors(self, open_doors, share):
        script = f"window.wallpaperLinks && wallpaperLinks({json.dumps(open_doors)}, {json.dumps(share)})"
        if script != self.doors_sent:
            self.doors_sent = script
            run_js(self.view, script)

    def arrive(self, side, x, y, data):
        run_js(self.view, f"window.wallpaperArrive && wallpaperArrive({json.dumps(side)}, {x:.1f}, {y:.1f}, {json.dumps(data)})")

    def screen_area(self):
        """The monitor in screen pixels, as (x0, y0, x1, y1)."""
        g, s = self.geometry, self.scale
        return g.x * s, g.y * s, (g.x + g.width) * s, (g.y + g.height) * s

    def throttle(self, covered):
        """Slow or pause the scene while windows cover this much (0 to 1) of the monitor."""
        fps = 0 if covered >= COVERED_PAUSE else SLOW_FPS if covered >= COVERED_SLOW else None
        if fps == self.throttled:
            return
        self.throttled = fps
        run_js(self.view, f"window.wallpaperThrottle && wallpaperThrottle({'null' if fps is None else fps})")

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


class Layout:
    """Joins the monitors' scenes where their edges touch, so a koi can swim from one to the next."""

    def __init__(self, ponds, enabled=True):
        self.ponds = ponds
        rects = [(p.geometry.x, p.geometry.y, p.geometry.width, p.geometry.height) for p in ponds]
        self.doors = doors(rects) if enabled else [[] for _ in ponds]
        for pond in ponds:
            pond.on_change = self.update

    def linked(self, i, j):
        a, b = self.ponds[i], self.ponds[j]
        return a.linkable and b.linkable and a.scene == b.scene and a.key == b.key

    def groups(self):
        """The ponds joined by open doors, as lists of indices."""
        seen, found = set(), []
        for start in range(len(self.ponds)):
            if start in seen:
                continue
            group, todo = [], [start]
            seen.add(start)
            while todo:
                i = todo.pop()
                group.append(i)
                for _side, j, _start, _end in self.doors[i]:
                    if j not in seen and self.linked(i, j):
                        seen.add(j)
                        todo.append(j)
            found.append(group)
        return found

    def shares(self):
        """How many animals each counted pond should hold: its group's total (each member's
        population added up), split by area; in mm² only when every member's size is known."""
        shares = {}
        for group in self.groups():
            members = [self.ponds[i] for i in group]
            if not all(p.population for p in members):
                continue
            known = all(p.pxmm for p in members)
            areas = [p.area() if known else p.geometry.width * p.geometry.height for p in members]
            total = sum(p.population for p in members)
            for i, a in zip(group, areas):
                shares[i] = total * a / sum(areas)
        return shares

    def update(self):
        """Open each page's doors to the neighbours with the same scene and look, and shut the rest;
        each door says how far over its share the neighbour is."""
        shares = self.shares()

        def surplus(j):
            count = self.ponds[j].count
            return None if count is None or j not in shares else round(count - shares[j], 3)

        for i, pond in enumerate(self.ponds):
            pond.set_doors([
                {"side": side, "from": start, "to": end, "surplus": surplus(j)}
                for side, j, start, end in self.doors[i] if self.linked(i, j)
            ], None if i not in shares else round(shares[i], 3))

    def reconcile(self):
        """A group short of its total (or over) gets one animal more (or less), on the pond
        furthest from its share; koi migrating between ponds see to the rest."""
        shares = self.shares()
        for group in self.groups():
            if any(i not in shares or self.ponds[i].count is None for i in group):
                continue
            total = sum(self.ponds[i].population for i in group)
            have = sum(self.ponds[i].count for i in group)
            if have == total:
                continue
            gap = {i: self.ponds[i].count - shares[i] for i in group}
            pond = self.ponds[(max if have > total else min)(group, key=gap.get)]
            step = -1 if have > total else 1
            pond.populate(step)
            pond.count += step  # until the page reports back
        self.update()
        return True

    def hand_off(self, i, side, x, y, data):
        """Pass what left pond i through `side` at its (x, y) to the neighbour there."""
        g = self.ponds[i].geometry
        along = y if side in "lr" else x
        for door_side, j, start, end in self.doors[i]:
            if door_side == side and start <= along <= end and self.linked(i, j):
                t = self.ponds[j].geometry
                self.ponds[j].arrive(OPPOSITE[side], g.x + x - t.x, g.y + y - t.y, data)
                # Until both pages report back, so the next door decision sees it moved.
                for k, step in ((i, -1), (j, 1)):
                    if self.ponds[k].count is not None:
                        self.ponds[k].count += step
                self.update()
                return
        # The door shut on the way (the neighbour switched scenes): send it back.
        self.ponds[i].arrive(side, x, y, data)


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
        self.position = x, y = g.x + (g.width - CHAT_W) // 2, g.y + (g.height - CHAT_H) // 2
        win.move(x, y)
        win.show_all()
        win.move(x, y)

    def set_scene(self, scene, visible):
        """Follow the scene menu: hide for scenes without a chat box, re-theme for the rest."""
        self.clock_theme = scene in CLOCK_THEMED
        self.update_theme()
        if not visible:
            self.win.hide()
        elif not self.win.get_visible():
            self.win.show_all()
            self.win.move(*self.position)

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
    # Without --scene, each monitor starts on what was last picked from the scene menu.
    flags = f"--koi {args.koi} --pads {args.pads} --fps {args.fps} --ai {args.ai}"
    if args.scene:
        flags = f"--scene {','.join(args.scene)} " + flags
    if args.no_chat:
        flags += " --no-chat"
    if args.monitor is not None:
        flags += f" --monitor {args.monitor}"
    if args.size:
        flags += " --size " + ",".join(f"{i}:{w:g}x{h:g}" for i, (w, h) in args.size.items())
    if args.no_link:
        flags += " --no-link"
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

    def size_list(value):
        sizes = {}
        for item in value.split(","):
            try:
                index, dims = item.split(":")
                w, h = dims.lower().split("x")
                sizes[int(index)] = (float(w), float(h))
            except ValueError:
                raise argparse.ArgumentTypeError("use MONITOR:WIDTHxHEIGHT in mm, e.g. 1:597x336") from None
        return sizes

    parser.add_argument("--scene", type=scene_list,
                        help=f"scene, or a comma list (one per monitor): {', '.join(SCENES)} "
                        "(default: the last one picked from the scene menu, else koi)")
    parser.add_argument("--koi", type=int, default=7, help="number of koi (default 7)")
    parser.add_argument("--pads", type=int, default=5, help="number of lily pads (default 5)")
    parser.add_argument("--cats", type=int, default=3, help="number of cats in the cats and shore scenes (default 3)")
    parser.add_argument("--ducks", type=int, default=4, help="number of microducks (default 4)")
    parser.add_argument("--env", choices=["room", "roof", "garden"],
                        help="cats scene environment: room, roof, garden (default room)")
    parser.add_argument("--view", choices=["top", "side"], help="ocean: look down from above or through the water")
    parser.add_argument("--species", choices=["mix", "manta", "whale"], help="ocean: which animals (default mix)")
    parser.add_argument("--fps", type=int, default=24, help="frame cap; lower saves CPU (default 24)")
    parser.add_argument("--monitor", type=int, help="only this monitor index")
    parser.add_argument("--size", type=size_list,
                        help="screen size in mm for monitors that report none or a wrong one, e.g. 1:597x336,0:531x299")
    parser.add_argument("--no-link", action="store_true", help="keep each monitor's scene to itself")
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

    query = {"koi": args.koi, "pads": args.pads, "cats": args.cats, "ducks": args.ducks, "fps": args.fps, "ai": args.ai}
    if args.env:
        query["env"] = args.env
    if args.hour is not None:
        query["hour"] = args.hour
    if args.cycle:
        query["cycle"] = args.cycle
    if args.view:
        query["view"] = args.view
    if args.species:
        query["species"] = args.species

    # What the scene menu last picked on each monitor; flags given on the command line win.
    picked = load_settings().get("menu", {})

    def choice(key):
        return {k: v for k, v in picked.get(key, {}).items() if k in MENU_KEYS and getattr(args, k, None) is None}

    def page(scene, chat, extra=None):
        chat = "off" if args.no_chat else chat
        return f"{(HERE / 'index.html').as_uri()}?{urlencode({**query, **(extra or {}), 'scene': scene, 'chat': chat})}"

    if args.window:
        win = Gtk.Window(title="ascii wallpaper")
        win.set_default_size(1280, 720)
        view = make_view(page((args.scene or ["koi"])[0], "full"))
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
        extras = [choice(str(i)) for i in indices]
        if args.scene:
            scenes = [args.scene[n % len(args.scene)] for n in range(len(indices))]
        else:
            scenes = [extra.get("scene") if extra.get("scene") in SCENES else "koi" for extra in extras]
        n = chat_on.index(True)
        overlay = None

        # Pixels per mm, so every monitor draws at the same physical size.
        pxmm = [px_per_mm(display.get_monitor(i), (args.size or {}).get(i)) for i in indices]
        if any(pxmm) and not all(pxmm):
            for i, v in zip(indices, pxmm):
                if not v:
                    print(f"monitor {i} reports no usable size; pass --size {i}:WIDTHxHEIGHT (mm) "
                          "to draw it at the others' scale", file=sys.stderr)
        for extra, v in zip(extras, pxmm):
            if v:
                extra["pxmm"] = f"{v:.3f}"

        def show_chat(scene):
            """The native chat controls sit over the primary monitor's scene, when it has a chat box."""
            nonlocal overlay
            visible = not args.no_chat and scene not in NO_CHAT
            if overlay:
                overlay.set_scene(scene, visible)
            elif visible:
                overlay = ChatOverlay(display.get_monitor(indices[n]), args.ai, scene in CLOCK_THEMED, args.hour, args.cycle)

        def on_menu(index, primary):
            def received(values):
                picked[str(index)] = {k: v for k, v in values.items() if k in MENU_KEYS}
                save_settings({"menu": picked})
                if primary and values.get("scene") in SCENES:
                    show_chat(values["scene"])
            return received

        def on_message(k, menu):
            """What pond k's page posts: news of its own (up, link key, count), a koi leaving through
            a door, or a menu pick."""
            def received(values):
                if values.keys() & {"ready", "key", "count"}:
                    ponds[k].hear(values)
                    return
                handoff = values.get("handoff")
                if isinstance(handoff, dict):
                    side, x, y = handoff.get("side"), handoff.get("x"), handoff.get("y")
                    if side in OPPOSITE and isinstance(x, (int, float)) and isinstance(y, (int, float)):
                        layout.hand_off(k, side, x, y, handoff.get("data"))
                    return
                menu(values)
            return received

        ponds = [
            Pond(display.get_monitor(i), page(scene, "glass" if on else "off", extra), on_message(k, on_menu(i, on)))
            for k, (i, scene, on, extra) in enumerate(zip(indices, scenes, chat_on, extras))
        ]
        for pond, v in zip(ponds, pxmm):
            pond.pxmm = v
        layout = Layout(ponds, not args.no_link)
        GLib.timeout_add(RECONCILE_MS, layout.reconcile)
        views = [pond.view for pond in ponds]
        show_chat(scenes[n])

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

        coverage = Coverage()

        def throttle():
            windows = coverage.windows()
            for pond in ponds:
                pond.throttle(Coverage.fraction(windows, pond.screen_area()))
            return True

        GLib.timeout_add(COVERAGE_MS, throttle)

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
