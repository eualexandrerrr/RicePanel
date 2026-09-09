[Português](README.pt-BR.md)

# RicePanel

A wall panel for the second monitor — the vertical one, the one that stays on
all day and that nobody uses for work. It answers from across the room the
questions you ask at a glance: what time is it, what is on today, is the machine
hot, is the server down, what is playing, when is the next match.

Electron on Arch Linux and Hyprland. No interface framework, no build step: it
is HTML, CSS and JavaScript read straight from disk.

## The two pages

**Mirante** — the page that stays open. Big clock, month calendar with the days
marked, Google Calendar agenda, machine thermals (one ring per part, with a real
photo of the part), CPU, RAM and disk gauges, network, what is playing on
Spotify with controls, the next Flamengo match and the countdown to GTA VI.

**Estação** — the work page. Two txAdmin consoles side by side (remote and
local), with an error detector that warns by notification; a column of Expo
projects with the Android emulator; and a monitor for quota, Sentry and Discord
notes.

## How the readings are taken

Everything local, with no extra service running:

| Reading | Where it comes from |
|---|---|
| CPU, memory, disks, network, uptime | `/proc`, `/sys`, Node's own `statfs` |
| CPU and SSD temperature | `/sys/class/hwmon` (k10temp, coretemp, nvme) |
| NVIDIA graphics card | `nvidia-smi --query-gpu` |
| AMD graphics card | `/sys/class/hwmon` of `amdgpu` + the device's PCI directory |
| Workspaces and focused window | `hyprctl -j` |
| What is playing | `playerctl` (MPRIS) |
| Pending updates | `checkupdates` (repo) and `paru -Qua` (AUR) |
| Agenda | Google Calendar secret address in iCal format |
| Next match | ESPN public scoreboard API |

None of it asks for sudo, and none of it queries a service that has to stay up.

## Decisions worth explaining

**The blur is not CSS.** The cards look like frosted glass over the wallpaper,
but `backdrop-filter` cannot see the Wayland compositor: underneath the window
there is nothing to blur. So `vidro.js` uses ffmpeg to generate a blurred copy
of the wallpaper and serves it as `background-attachment: fixed` — the crop
follows the card and the effect closes.

**The agenda is iCal, not OAuth.** The panel sits alone on a monitor. A refresh
token that expires when the password changes would leave the agenda mute,
waiting for somebody who is not in front of the machine. The secret address is
a read-only URL that only the owner can revoke.

**The scale is wall scale, not desk scale.** The text floor is 11.5px in
`subtext0` — not 10px in mid grey. He reads this from two metres away, from the
other monitor, over a saturated illustrated wallpaper. A label that disappears
takes with it the number it names.

**One ring per part, built from the portrait.** How many graphics cards the
machine has is the machine's business, not the HTML's. The real photo next to
the ring is what you recognise from a distance — from two metres nobody reads
"RTX 3090", but everybody recognises a three-fan cooler.

**GPU acceleration is off by default, and that is measured, not belief.** On
this machine (two cards, Wayland, transparent window) every accelerated
combination ended in a window that paints nothing: with `use-angle=vulkan` the
gpu-process dies in a loop and takes the compositor with it; with
`use-angle=gl`, with or without `render-node-override` on the Radeon,
`eglCreateImage` fails with `EGL_BAD_MATCH`, the GPU child is killed and the
panel becomes an invisible rectangle over the wallpaper — the app stays alive,
log and all, and the screen is empty. So: software rendering by default, which
is the only state in which the page shows up, and the video stutter is solved
from the other side, by capping the player quality at 720p. `RICEPANEL_COM_GPU=1`
turns the accelerated version back on for anyone who wants to try again.

**The app_id given to Hyprland is lowercase.** Electron would announce the
`productName` ("RicePanel"), and the window rule in `hypr/.config/hypr/regras.lua`
matches `class = "ricepanel"` — the match is case sensitive. So the app yields:
`--class=ricepanel`, and the compositor stays the owner of the placement, which
in Wayland is where that decision belongs.

## Running

```bash
npm install
npm start          # or ./reiniciar.sh, which kills whatever is already up
```

Needs: Electron 33, `playerctl`, `hyprctl` (optional), `nvidia-smi` or `amdgpu`
(optional), `checkupdates` from `pacman-contrib`, `paru` (optional), `ffmpeg`
for the glass and `awww` (the wallpaper daemon it queries for the current
wallpaper).

No configuration lives in the repository. What is yours lives in
`~/.config/RicePanel/`:

| File | What |
|---|---|
| `servidores.json` | host and port of the two txAdmin consoles |
| `discord-notas.json` | guild, channel and path to txAdmin's `config.json` |
| `agenda-url.txt` or `agenda-url.bin` | the iCal secret address, encrypted when there is a keyring |

Without those files the panel comes up all the same, with the matching modules
turned off — none of them is mandatory.

## License

Code under MIT. The photos in `fotos/` and the fonts in `fontes/` have their own
licences, credited in `fotos/CREDITOS.md` and in `LICENSE`.
