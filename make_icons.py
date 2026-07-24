from PIL import Image, ImageDraw, ImageFont

BG = (28, 110, 140)
FG = (255, 255, 255)

for size in (192, 512):
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)
    text = "ת"
    font_size = int(size * 0.6)
    try:
        font = ImageFont.truetype("arial.ttf", font_size)
    except OSError:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), text, font=font, fill=FG)
    img.save(f"icons/icon-{size}.png")
    print(f"wrote icons/icon-{size}.png")
