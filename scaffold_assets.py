#!/usr/bin/env python3
"""플러그인 이미지 플레이스홀더 생성 (stdlib만). setImage가 런타임에 덮으므로 단색이면 충분."""
import zlib, struct, os, sys

def solid_png(path, w, h, rgb=(13, 17, 23)):
    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(png)

if __name__ == '__main__':
    base = sys.argv[1] if len(sys.argv) > 1 else \
        'plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/images'
    for name in ('cate', 'icon', 'defaultImage'):
        solid_png(os.path.join(base, f'{name}.png'), 144, 144)
    print('assets written to', base)
