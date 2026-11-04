//! Pixel work for Preview. Everything operates on straight-alpha RGBA8 buffers that JS copies into
//! linear memory. The colour pipeline here is the CPU twin of `ADJUST_FRAG` in `src/lib/imaging.ts`;
//! keep the two in step so a GPU-less machine produces the same picture.

use std::cell::RefCell;

thread_local! {
    static HIST: RefCell<[u32; 1024]> = const { RefCell::new([0; 1024]) };
    static LEVELS: RefCell<[f32; 3]> = const { RefCell::new([0.0, 1.0, 1.0]) };
    static MASK: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Adjustment parameters, in the order JS writes them into the f32 array passed to `img_adjust`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Adjust {
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub tint: f32,
    pub sepia: f32,
    pub sharpness: f32,
    pub black: f32,
    pub white: f32,
    pub gamma: f32,
}
pub const ADJUST_LEN: usize = 12;

impl Adjust {
    #[allow(dead_code)]
    pub const IDENTITY: Adjust = Adjust {
        exposure: 0.0,
        contrast: 0.0,
        highlights: 0.0,
        shadows: 0.0,
        saturation: 0.0,
        temperature: 0.0,
        tint: 0.0,
        sepia: 0.0,
        sharpness: 0.0,
        black: 0.0,
        white: 1.0,
        gamma: 1.0,
    };
    fn from_slice(p: &[f32]) -> Adjust {
        Adjust {
            exposure: p[0],
            contrast: p[1],
            highlights: p[2],
            shadows: p[3],
            saturation: p[4],
            temperature: p[5],
            tint: p[6],
            sepia: p[7],
            sharpness: p[8],
            black: p[9],
            white: p[10],
            gamma: p[11],
        }
    }
}

const LUMA: [f32; 3] = [0.2126, 0.7152, 0.0722];

#[inline]
fn luma(c: [f32; 3]) -> f32 {
    c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2]
}

#[inline]
fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Stage 1 of the colour pipeline: levels, exposure and white balance. Each output channel depends
/// only on the same input channel, which is what lets `adjust` precompute it into lookup tables.
#[inline]
fn tone(v: f32, k: usize, a: &Adjust) -> f32 {
    let span = (a.white - a.black).max(1e-3);
    let v = ((v - a.black) / span).clamp(0.0, 1.0).powf(1.0 / a.gamma.max(0.01)) * a.exposure.exp2();
    match k {
        0 => v * (1.0 + 0.2 * a.temperature),
        1 => v * (1.0 - 0.15 * a.tint),
        _ => v * (1.0 - 0.2 * a.temperature),
    }
}

/// Stage 2: everything that mixes channels (shadows/highlights, contrast, saturation, sepia).
#[inline]
fn mix(mut c: [f32; 3], a: &Adjust) -> [f32; 3] {
    let l = luma(c);
    let lift = a.shadows * (1.0 - smoothstep(0.0, 0.5, l)) * 0.35 + a.highlights * smoothstep(0.5, 1.0, l) * 0.35;
    for v in c.iter_mut() {
        *v = (*v + lift - 0.5) * (1.0 + a.contrast) + 0.5;
    }

    let l = luma(c);
    for v in c.iter_mut() {
        *v = l + (*v - l) * (1.0 + a.saturation);
    }

    if a.sepia > 0.0 {
        let s = [
            c[0] * 0.393 + c[1] * 0.769 + c[2] * 0.189,
            c[0] * 0.349 + c[1] * 0.686 + c[2] * 0.168,
            c[0] * 0.272 + c[1] * 0.534 + c[2] * 0.131,
        ];
        for k in 0..3 {
            c[k] += (s[k] - c[k]) * a.sepia;
        }
    }
    c.map(|v| v.clamp(0.0, 1.0))
}

/// The per-pixel colour pipeline (everything except sharpening, which needs neighbours).
pub fn grade(c: [f32; 3], a: &Adjust) -> [f32; 3] {
    mix([tone(c[0], 0, a), tone(c[1], 1, a), tone(c[2], 2, a)], a)
}

#[inline]
fn store(px: &mut [u8], o: usize, g: [f32; 3]) {
    for k in 0..3 {
        px[o + k] = (g[k] * 255.0 + 0.5) as u8;
    }
}

pub fn adjust(px: &mut [u8], w: usize, h: usize, a: &Adjust) {
    if a.sharpness <= 0.0 {
        // Fast path: inputs are 8-bit, so stage 1 is three 256-entry tables (no powf per pixel).
        let mut lut = [[0f32; 256]; 3];
        for (k, t) in lut.iter_mut().enumerate() {
            for (i, v) in t.iter_mut().enumerate() {
                *v = tone(i as f32 / 255.0, k, a);
            }
        }
        for o in (0..w * h * 4).step_by(4) {
            let g = mix([lut[0][px[o] as usize], lut[1][px[o + 1] as usize], lut[2][px[o + 2] as usize]], a);
            store(px, o, g);
        }
        return;
    }
    let src = px.to_vec();
    let at = |x: usize, y: usize, k: usize| src[(y * w + x) * 4 + k] as f32 / 255.0;
    for y in 0..h {
        for x in 0..w {
            let o = (y * w + x) * 4;
            let mut c = [px[o] as f32 / 255.0, px[o + 1] as f32 / 255.0, px[o + 2] as f32 / 255.0];
            let (xl, xr) = (x.saturating_sub(1), (x + 1).min(w - 1));
            let (yu, yd) = (y.saturating_sub(1), (y + 1).min(h - 1));
            for (k, v) in c.iter_mut().enumerate() {
                let avg = (at(xl, y, k) + at(xr, y, k) + at(x, yu, k) + at(x, yd, k)) * 0.25;
                *v = (*v + a.sharpness * 1.5 * (*v - avg)).clamp(0.0, 1.0);
            }
            store(px, o, grade(c, a));
        }
    }
}

/// 4 × 256 bins: red, green, blue, luma. Fully transparent pixels are skipped.
pub fn histogram(px: &[u8]) -> [u32; 1024] {
    let mut h = [0u32; 1024];
    for p in px.chunks_exact(4) {
        if p[3] == 0 {
            continue;
        }
        h[p[0] as usize] += 1;
        h[256 + p[1] as usize] += 1;
        h[512 + p[2] as usize] += 1;
        let l = luma([p[0] as f32, p[1] as f32, p[2] as f32]);
        h[768 + (l as usize).min(255)] += 1;
    }
    h
}

/// Black point, white point and gamma that stretch the luma histogram, clipping 0.5% at each end
/// and pulling the mean toward middle grey.
pub fn auto_levels(hist: &[u32; 1024]) -> [f32; 3] {
    let l = &hist[768..];
    let total: u64 = l.iter().map(|&n| n as u64).sum();
    if total == 0 {
        return [0.0, 1.0, 1.0];
    }
    let clip = total / 200;
    let (mut lo, mut acc) = (0usize, 0u64);
    while lo < 255 && acc + l[lo] as u64 <= clip {
        acc += l[lo] as u64;
        lo += 1;
    }
    let (mut hi, mut acc) = (255usize, 0u64);
    while hi > lo + 1 && acc + l[hi] as u64 <= clip {
        acc += l[hi] as u64;
        hi -= 1;
    }
    let (black, white) = (lo as f32 / 255.0, hi as f32 / 255.0);
    let mean = l.iter().enumerate().map(|(i, &n)| i as f64 * n as f64).sum::<f64>() / total as f64 / 255.0;
    let m = ((mean as f32 - black) / (white - black).max(1e-3)).clamp(0.02, 0.98);
    let gamma = (m.ln() / 0.5f32.ln()).clamp(0.4, 2.5);
    [black, white, gamma]
}

/// Contiguous (4-connected) region around `(sx, sy)` whose colour is within `tol` of the seed.
/// Returns a w×h mask of 0 / 255 and the number of pixels selected.
pub fn flood_mask(px: &[u8], w: usize, h: usize, sx: usize, sy: usize, tol: f32, mask: &mut Vec<u8>) -> u32 {
    mask.clear();
    mask.resize(w * h, 0);
    if sx >= w || sy >= h {
        return 0;
    }
    let seed = (sy * w + sx) * 4;
    let s = [px[seed] as f32, px[seed + 1] as f32, px[seed + 2] as f32, px[seed + 3] as f32];
    let tol2 = tol * tol * 3.0;
    let near = |i: usize| {
        let o = i * 4;
        let d = [px[o] as f32 - s[0], px[o + 1] as f32 - s[1], px[o + 2] as f32 - s[2], px[o + 3] as f32 - s[3]];
        d[0] * d[0] + d[1] * d[1] + d[2] * d[2] + d[3] * d[3] <= tol2
    };
    let mut count = 0u32;
    let mut stack = vec![(sx, sy)];
    while let Some((x, y)) = stack.pop() {
        let row = y * w;
        if mask[row + x] != 0 {
            continue;
        }
        let mut l = x;
        while l > 0 && mask[row + l - 1] == 0 && near(row + l - 1) {
            l -= 1;
        }
        let mut r = x;
        while r + 1 < w && mask[row + r + 1] == 0 && near(row + r + 1) {
            r += 1;
        }
        for i in l..=r {
            mask[row + i] = 255;
        }
        count += (r - l + 1) as u32;
        for ny in [y.wrapping_sub(1), y + 1] {
            if ny >= h {
                continue;
            }
            let nrow = ny * w;
            let mut i = l;
            while i <= r {
                if mask[nrow + i] == 0 && near(nrow + i) {
                    stack.push((i, ny));
                    while i <= r && mask[nrow + i] == 0 && near(nrow + i) {
                        i += 1;
                    }
                }
                i += 1;
            }
        }
    }
    count
}

// ---- FFI ----------------------------------------------------------------------------------------

#[no_mangle]
pub unsafe extern "C" fn img_adjust(ptr: *mut u8, w: u32, h: u32, params: *const f32) {
    let (w, h) = (w as usize, h as usize);
    let px = std::slice::from_raw_parts_mut(ptr, w * h * 4);
    let p = std::slice::from_raw_parts(params, ADJUST_LEN);
    adjust(px, w, h, &Adjust::from_slice(p));
}

#[no_mangle]
pub unsafe extern "C" fn img_histogram(ptr: *const u8, len: usize) -> *const u32 {
    let h = histogram(std::slice::from_raw_parts(ptr, len));
    HIST.with(|cell| {
        *cell.borrow_mut() = h;
        cell.borrow().as_ptr()
    })
}

/// Computes levels from the last `img_histogram` call.
#[no_mangle]
pub extern "C" fn img_auto_levels() -> *const f32 {
    let l = HIST.with(|h| auto_levels(&h.borrow()));
    LEVELS.with(|cell| {
        *cell.borrow_mut() = l;
        cell.borrow().as_ptr()
    })
}

/// Returns a pointer to the mask (w*h bytes); the selected pixel count is written to `count_out`.
#[no_mangle]
pub unsafe extern "C" fn img_flood_mask(ptr: *const u8, w: u32, h: u32, x: u32, y: u32, tol: f32, count_out: *mut u32) -> *const u8 {
    let (w, h) = (w as usize, h as usize);
    let px = std::slice::from_raw_parts(ptr, w * h * 4);
    MASK.with(|m| {
        let mut m = m.borrow_mut();
        *count_out = flood_mask(px, w, h, x as usize, y as usize, tol, &mut m);
        m.as_ptr()
    })
}

/// Clears alpha wherever the last flood mask is set, softening the one-pixel rim so edges aren't jagged.
#[no_mangle]
pub unsafe extern "C" fn img_apply_mask(ptr: *mut u8, w: u32, h: u32) {
    let (w, h) = (w as usize, h as usize);
    let px = std::slice::from_raw_parts_mut(ptr, w * h * 4);
    MASK.with(|m| {
        let m = m.borrow();
        if m.len() != w * h {
            return;
        }
        for y in 0..h {
            for x in 0..w {
                let i = y * w + x;
                if m[i] != 0 {
                    px[i * 4 + 3] = 0;
                    continue;
                }
                let edge = (x > 0 && m[i - 1] != 0) as u8 + (x + 1 < w && m[i + 1] != 0) as u8 + (y > 0 && m[i - w] != 0) as u8 + (y + 1 < h && m[i + w] != 0) as u8;
                if edge > 0 {
                    px[i * 4 + 3] = (px[i * 4 + 3] as u32 * (4 - edge as u32 / 2) / 4) as u8;
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_is_lossless() {
        let mut px: Vec<u8> = (0..=255u8).flat_map(|v| [v, 255 - v, v / 2, 255]).collect();
        let before = px.clone();
        adjust(&mut px, 256, 1, &Adjust::IDENTITY);
        assert_eq!(px, before);
    }

    #[test]
    fn saturation_minus_one_is_grey() {
        let a = Adjust { saturation: -1.0, ..Adjust::IDENTITY };
        let g = grade([1.0, 0.0, 0.0], &a);
        assert!((g[0] - g[1]).abs() < 1e-5 && (g[1] - g[2]).abs() < 1e-5);
    }

    #[test]
    fn exposure_doubles() {
        let a = Adjust { exposure: 1.0, ..Adjust::IDENTITY };
        assert!((grade([0.25, 0.25, 0.25], &a)[0] - 0.5).abs() < 1e-5);
    }

    #[test]
    fn levels_stretch_a_flat_image() {
        let px: Vec<u8> = (0..1000).flat_map(|i| {
            let v = 64 + (i % 128) as u8;
            [v, v, v, 255]
        }).collect();
        let [b, w, _] = auto_levels(&histogram(&px));
        assert!(b > 0.24 && b < 0.27, "black {b}");
        assert!(w > 0.73 && w < 0.76, "white {w}");
    }

    #[test]
    fn lut_path_matches_direct_grade() {
        let a = Adjust { exposure: 0.4, contrast: 0.3, saturation: -0.4, temperature: 0.5, tint: -0.3, sepia: 0.2, black: 0.05, white: 0.92, gamma: 1.4, shadows: 0.3, highlights: -0.2, ..Adjust::IDENTITY };
        let mut px: Vec<u8> = (0..4096u32).flat_map(|i| [(i * 7 % 256) as u8, (i * 13 % 256) as u8, (i * 29 % 256) as u8, 255]).collect();
        let want: Vec<u8> = px.chunks_exact(4).flat_map(|p| {
            let g = grade([p[0] as f32 / 255.0, p[1] as f32 / 255.0, p[2] as f32 / 255.0], &a);
            [(g[0] * 255.0 + 0.5) as u8, (g[1] * 255.0 + 0.5) as u8, (g[2] * 255.0 + 0.5) as u8, 255]
        }).collect();
        adjust(&mut px, 64, 64, &a);
        assert_eq!(px, want);
    }

    #[test]
    fn flood_stops_at_edges() {
        // 4×3: left half red, right half blue.
        let (w, h) = (4, 3);
        let px: Vec<u8> = (0..w * h).flat_map(|i| if i % w < 2 { [255, 0, 0, 255] } else { [0, 0, 255, 255] }).collect();
        let mut m = Vec::new();
        assert_eq!(flood_mask(&px, w, h, 0, 0, 10.0, &mut m), 6);
        assert!(m.iter().enumerate().all(|(i, &v)| (v != 0) == (i % w < 2)));
        assert_eq!(flood_mask(&px, w, h, 3, 2, 255.0, &mut m), 12);
    }
}
