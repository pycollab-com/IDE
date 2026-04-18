#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


REPO_ROOT = Path(__file__).resolve().parent.parent
DESKTOP_DIR = REPO_ROOT / "desktop"
APP_PATH = Path("/Applications/PyCollab IDE.app")
LOGO_PATH = REPO_ROOT / "logo.png"
ICON_PATH = DESKTOP_DIR / "assets" / "PyCollabIDE.icns"
OUTPUT_DMG = REPO_ROOT / "PyCollab IDE.dmg"
VOLUME_NAME = "PyCollab IDE"
BACKGROUND_SIZE = (1180, 730)
WINDOW_BOUNDS = (170, 130, 1350, 860)
APP_ICON_POS = (260, 545)
APPLICATIONS_ICON_POS = (920, 545)

PRIMARY = "#899878"
SECONDARY = "#7F8E6D"
ACCENT = "#9CAA88"
BG = "#121113"
TEXT = "#F7F7F2"
MUTED = "#C9CCBF"
GRID = "#2A292D"


def run(cmd: list[str], **kwargs):
    subprocess.run(cmd, check=True, **kwargs)


def font(size: int, bold: bool = False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            try:
                return ImageFont.truetype(candidate, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def draw_grid(draw: ImageDraw.ImageDraw, width: int, height: int):
    for x in range(0, width, 64):
        draw.line((x, 0, x, height), fill=GRID, width=1)
    for y in range(0, height, 64):
        draw.line((0, y, width, y), fill=GRID, width=1)


def draw_glow(base: Image.Image, bbox, color: str, blur: int):
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.rounded_rectangle(bbox, radius=32, fill=color)
    glow = glow.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(glow)


def generate_background(target: Path):
    width, height = BACKGROUND_SIZE
    image = Image.new("RGBA", (width, height), BG)
    draw = ImageDraw.Draw(image)

    draw_grid(draw, width, height)

    # Motion-inspired green glows.
    draw_glow(image, (60, 70, 500, 320), (*ImageColor.getrgb(PRIMARY), 100), 54)
    draw_glow(image, (690, 160, 1110, 500), (*ImageColor.getrgb(ACCENT), 84), 64)

    # Soft spotlight.
    spotlight = Image.new("RGBA", image.size, (0, 0, 0, 0))
    spotlight_draw = ImageDraw.Draw(spotlight)
    spotlight_draw.ellipse((640, 70, 1140, 680), fill=(156, 170, 136, 42))
    spotlight = spotlight.filter(ImageFilter.GaussianBlur(92))
    image.alpha_composite(spotlight)

    panel = (42, 42, width - 42, height - 42)
    draw.rounded_rectangle(panel, radius=34, fill=(20, 19, 22, 232), outline=(73, 79, 68, 180), width=2)

    logo = Image.open(LOGO_PATH).convert("RGBA")
    logo.thumbnail((186, 186), Image.LANCZOS)
    logo_x = 110
    logo_y = 126

    logo_glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    logo_glow.paste(logo, (logo_x, logo_y), logo)
    logo_glow = logo_glow.filter(ImageFilter.GaussianBlur(24))
    image.alpha_composite(logo_glow)
    image.alpha_composite(logo, (logo_x, logo_y))

    title_font = font(66, bold=True)
    subtitle_font = font(28)
    label_font = font(26, bold=True)
    small_font = font(18)

    draw.text((372, 128), "PyCollab IDE", font=title_font, fill=TEXT)
    draw.text((378, 226), "Offline editing for competitions.", font=subtitle_font, fill=MUTED)
    draw.text((378, 270), "Drag the app into Applications to install.", font=subtitle_font, fill=MUTED)

    # Motion lines.
    streak = Image.new("RGBA", image.size, (0, 0, 0, 0))
    streak_draw = ImageDraw.Draw(streak)
    for offset, alpha in [(0, 120), (18, 80), (36, 52)]:
        streak_draw.rounded_rectangle(
            (382 + offset, 398 + offset // 3, 988 + offset, 410 + offset // 3),
            radius=12,
            fill=(156, 170, 136, alpha),
        )
    streak = streak.filter(ImageFilter.GaussianBlur(8))
    image.alpha_composite(streak)

    # Install stage.
    left_card = (88, 468, 432, 682)
    right_card = (748, 468, 1092, 682)
    draw.rounded_rectangle(left_card, radius=34, fill=(9, 9, 11, 205), outline=(137, 152, 120, 215), width=3)
    draw.rounded_rectangle(right_card, radius=34, fill=(9, 9, 11, 205), outline=(137, 152, 120, 215), width=3)
    draw.text((164, 636), "PyCollab IDE", font=label_font, fill=TEXT)
    draw.text((822, 636), "Applications", font=label_font, fill=TEXT)

    arrow_points = [(500, 556), (670, 556), (670, 514), (758, 586), (670, 658), (670, 616), (500, 616)]
    draw.polygon(arrow_points, fill=ACCENT)
    draw.text((572, 484), "Install", font=small_font, fill=MUTED)

    target.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(target, "PNG")


def set_finder_layout(mount_path: Path):
    volume_name = mount_path.name.replace('"', '\\"')
    applescript = f'''
    tell application "Finder"
      activate
      tell disk "{volume_name}"
        open
        delay 1
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set bounds of container window to {{{WINDOW_BOUNDS[0]}, {WINDOW_BOUNDS[1]}, {WINDOW_BOUNDS[2]}, {WINDOW_BOUNDS[3]}}}
        delay 1
        set theViewOptions to the icon view options of container window
        set arrangement of theViewOptions to not arranged
        set icon size of theViewOptions to 128
        set text size of theViewOptions to 16
        set background picture of theViewOptions to file ".background:background.png"
        delay 1
        set position of item "PyCollab IDE.app" of container window to {{{APP_ICON_POS[0]}, {APP_ICON_POS[1]}}}
        set position of item "Applications" of container window to {{{APPLICATIONS_ICON_POS[0]}, {APPLICATIONS_ICON_POS[1]}}}
        update without registering applications
        delay 3
        close
        open
        delay 1
      end tell
    end tell
    '''
    run(["osascript", "-e", applescript])


def wait_for_finder_metadata(mount_path: Path, timeout_seconds: int = 12):
    ds_store = mount_path / ".DS_Store"
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if ds_store.exists() and ds_store.stat().st_size > 0:
            return
        time.sleep(0.5)
    raise RuntimeError(f"Finder did not persist DMG layout metadata for {mount_path}")


def main():
    if not APP_PATH.exists():
        raise SystemExit(f"Missing app bundle: {APP_PATH}")

    temp_root = Path(tempfile.mkdtemp(prefix="pycollab-dmg-"))
    stage_dir = temp_root / "stage"
    background_dir = stage_dir / ".background"
    background_png = background_dir / "background.png"
    rw_dmg = temp_root / "PyCollab IDE-temp.dmg"

    try:
        stage_dir.mkdir(parents=True, exist_ok=True)
        background_dir.mkdir(parents=True, exist_ok=True)

        generate_background(background_png)
        shutil.copytree(APP_PATH, stage_dir / APP_PATH.name, dirs_exist_ok=True)
        shutil.copy2(ICON_PATH, stage_dir / ".VolumeIcon.icns")
        applications_link = stage_dir / "Applications"
        if applications_link.exists() or applications_link.is_symlink():
            applications_link.unlink()
        applications_link.symlink_to("/Applications")

        run(["hdiutil", "create", "-srcfolder", str(stage_dir), "-volname", VOLUME_NAME, "-fs", "HFS+", "-format", "UDRW", str(rw_dmg)])
        attach = subprocess.run(
            ["hdiutil", "attach", str(rw_dmg), "-noautoopen"],
            check=True,
            capture_output=True,
            text=True,
        )
        mount_lines = [line for line in attach.stdout.splitlines() if "/Volumes/" in line]
        if not mount_lines:
            raise RuntimeError("Could not determine mounted DMG path.")
        mount_dir = Path(mount_lines[-1].split("\t")[-1].strip())

        try:
            run(["SetFile", "-a", "V", str(mount_dir / ".background")])
            run(["SetFile", "-a", "V", str(mount_dir / ".VolumeIcon.icns")])
            run(["SetFile", "-a", "C", str(mount_dir)])
            time.sleep(1)
            set_finder_layout(mount_dir)
            wait_for_finder_metadata(mount_dir)
        finally:
            run(["hdiutil", "detach", str(mount_dir)])

        if OUTPUT_DMG.exists():
            OUTPUT_DMG.unlink()
        run(["hdiutil", "convert", str(rw_dmg), "-format", "UDZO", "-imagekey", "zlib-level=9", "-o", str(OUTPUT_DMG)])
        print(OUTPUT_DMG)
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == "__main__":
    from PIL import ImageColor

    main()
