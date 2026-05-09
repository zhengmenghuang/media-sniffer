from pathlib import Path
import struct
import zlib

def write_chunk(chunk_type, data):
    c = chunk_type + data
    return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

def create_png(size):
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    ihdr = write_chunk(b'IHDR', ihdr_data)
    
    rows = []
    cx, cy = size/2, size/2
    r = size/2 * 0.9
    
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            dx, dy = x - cx, y - cy
            dist = (dx*dx + dy*dy) ** 0.5
            if dist <= r:
                t = (dx + dy) / (2*r) * 0.3
                rb = max(0, min(255, int(91 + t * 30)))
                gb = max(0, min(255, int(110 + t * 20)))
                bb = max(0, min(255, int(245 - t * 80)))
                tx, ty2 = x - cx, y - cy
                in_play = (tx > -r*0.25 and abs(ty2) < r*0.32 - (tx - (-r*0.25))*0.5 and tx < r*0.3)
                if in_play:
                    row += bytes([255, 255, 255])
                else:
                    row += bytes([rb, gb, bb])
            else:
                row += bytes([26, 29, 35])
        rows.append(bytes(row))
    
    raw = b''.join(rows)
    compressed = zlib.compress(raw, 9)
    idat = write_chunk(b'IDAT', compressed)
    iend = write_chunk(b'IEND', b'')
    return sig + ihdr + idat + iend

icons_dir = Path(__file__).resolve().parents[1] / "src" / "icons"
icons_dir.mkdir(parents=True, exist_ok=True)

for size in [16, 48, 128]:
    png_data = create_png(size)
    out = icons_dir / f"icon{size}.png"
    with open(out, 'wb') as f:
        f.write(png_data)
    print(f"Created {out} ({len(png_data)} bytes)")

print("Done!")
