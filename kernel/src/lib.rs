mod imaging;
mod junk;
mod tetrisai;

use std::cell::RefCell;

const VERSION: &str = "Pearnel Kernel Version 24.1.0: Tue Sep 16 09:41:00 PDT 2025; root:pnu-11215.1.10~2/RELEASE_WASM32 wasm32";

thread_local! {
    static FRAME: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static RNG: RefCell<u64> = const { RefCell::new(0x9E37_79B9_7F4A_7C15) };
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

#[no_mangle]
pub extern "C" fn kernel_version_ptr() -> *const u8 {
    VERSION.as_ptr()
}

#[no_mangle]
pub extern "C" fn kernel_version_len() -> usize {
    VERSION.len()
}

unsafe fn str_from<'a>(ptr: *const u8, len: usize) -> &'a str {
    std::str::from_utf8(std::slice::from_raw_parts(ptr, len)).unwrap_or("")
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
}

impl<'a> Parser<'a> {
    fn ws(&mut self) {
        while self.i < self.s.len() && self.s[self.i].is_ascii_whitespace() {
            self.i += 1;
        }
    }
    fn peek(&mut self) -> Option<u8> {
        self.ws();
        self.s.get(self.i).copied()
    }
    fn eat(&mut self, c: u8) -> bool {
        if self.peek() == Some(c) {
            self.i += 1;
            true
        } else {
            false
        }
    }
    fn expr(&mut self) -> Option<f64> {
        let mut v = self.term()?;
        loop {
            if self.eat(b'+') {
                v += self.term()?;
            } else if self.eat(b'-') {
                v -= self.term()?;
            } else {
                return Some(v);
            }
        }
    }
    fn term(&mut self) -> Option<f64> {
        let mut v = self.unary()?;
        loop {
            if self.eat(b'*') {
                v *= self.unary()?;
            } else if self.eat(b'/') {
                v /= self.unary()?;
            } else if self.eat(b'%') {
                match self.peek() {
                    None | Some(b'+') | Some(b'-') | Some(b')') | Some(b'*') | Some(b'/') => v /= 100.0,
                    _ => v %= self.unary()?,
                }
            } else if matches!(self.peek(), Some(b'(')) || matches!(self.peek(), Some(c) if c.is_ascii_alphabetic()) {
                v *= self.unary()?;
            } else {
                return Some(v);
            }
        }
    }
    fn unary(&mut self) -> Option<f64> {
        if self.eat(b'-') {
            return Some(-self.unary()?);
        }
        if self.eat(b'+') {
            return self.unary();
        }
        self.power()
    }
    fn power(&mut self) -> Option<f64> {
        let base = self.postfix()?;
        if self.eat(b'^') {
            Some(base.powf(self.unary()?))
        } else {
            Some(base)
        }
    }
    fn postfix(&mut self) -> Option<f64> {
        let mut v = self.primary()?;
        while self.eat(b'!') {
            if v < 0.0 || v.fract() != 0.0 || v > 170.0 {
                return Some(f64::NAN);
            }
            v = (1..=v as u64).fold(1.0, |a, k| a * k as f64);
        }
        Some(v)
    }
    fn primary(&mut self) -> Option<f64> {
        let c = self.peek()?;
        if c == b'(' {
            self.i += 1;
            let v = self.expr()?;
            self.eat(b')');
            return Some(v);
        }
        if c.is_ascii_digit() || c == b'.' {
            let start = self.i;
            while self.i < self.s.len() && (self.s[self.i].is_ascii_digit() || self.s[self.i] == b'.') {
                self.i += 1;
            }
            if self.i < self.s.len() && (self.s[self.i] == b'e' || self.s[self.i] == b'E') {
                let save = self.i;
                self.i += 1;
                if self.i < self.s.len() && (self.s[self.i] == b'-' || self.s[self.i] == b'+') {
                    self.i += 1;
                }
                if self.i < self.s.len() && self.s[self.i].is_ascii_digit() {
                    while self.i < self.s.len() && self.s[self.i].is_ascii_digit() {
                        self.i += 1;
                    }
                } else {
                    self.i = save;
                }
            }
            return std::str::from_utf8(&self.s[start..self.i]).ok()?.parse().ok();
        }
        if c.is_ascii_alphabetic() {
            let start = self.i;
            while self.i < self.s.len() && self.s[self.i].is_ascii_alphanumeric() {
                self.i += 1;
            }
            let name = std::str::from_utf8(&self.s[start..self.i]).ok()?.to_ascii_lowercase();
            let constant = match name.as_str() {
                "pi" => Some(std::f64::consts::PI),
                "e" => Some(std::f64::consts::E),
                "tau" => Some(std::f64::consts::TAU),
                "phi" => Some(1.618_033_988_749_895),
                "gb" => Some(2.0),
                _ => None,
            };
            if let Some(k) = constant {
                return Some(k);
            }
            let arg = self.unary()?;
            let f: fn(f64) -> f64 = match name.as_str() {
                "sqrt" => f64::sqrt,
                "cbrt" => f64::cbrt,
                "sin" => f64::sin,
                "cos" => f64::cos,
                "tan" => f64::tan,
                "asin" => f64::asin,
                "acos" => f64::acos,
                "atan" => f64::atan,
                "ln" => f64::ln,
                "log" => f64::log10,
                "exp" => f64::exp,
                "abs" => f64::abs,
                "floor" => f64::floor,
                "ceil" => f64::ceil,
                "round" => f64::round,
                _ => return None,
            };
            return Some(f(arg));
        }
        None
    }
}
#[no_mangle]
pub unsafe extern "C" fn calc(ptr: *const u8, len: usize) -> f64 {
    let src = str_from(ptr, len);
    let mut p = Parser { s: src.as_bytes(), i: 0 };
    match p.expr() {
        Some(v) if p.peek().is_none() => v,
        _ => f64::NAN,
    }
}

fn palette(t: f64, scheme: u32) -> [u8; 3] {
    let (a, b, c, d): ([f64; 3], [f64; 3], [f64; 3], [f64; 3]) = match scheme {
        1 => ([0.45, 0.55, 0.25], [0.45, 0.45, 0.25], [1.0, 1.0, 1.0], [0.05, 0.10, 0.30]),
        2 => ([0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1.0, 1.0, 1.0], [0.0, 0.33, 0.67]),       
        _ => ([0.35, 0.40, 0.65], [0.35, 0.35, 0.35], [1.0, 1.0, 1.0], [0.55, 0.60, 0.70]),
    };
    let mut out = [0u8; 3];
    for k in 0..3 {
        let v = a[k] + b[k] * (std::f64::consts::TAU * (c[k] * t + d[k])).cos();
        out[k] = (v.clamp(0.0, 1.0) * 255.0) as u8;
    }
    out
}
#[no_mangle]
pub extern "C" fn render_mandelbrot(w: u32, h: u32, cx: f64, cy: f64, scale: f64, max_iter: u32, scheme: u32) -> *const u8 {
    let (w, h) = (w as usize, h as usize);
    FRAME.with(|f| {
        let mut buf = f.borrow_mut();
        buf.resize(w * h * 4, 0);
        let aspect = w as f64 / h.max(1) as f64;
        for py in 0..h {
            let y0 = cy + (py as f64 / h as f64 - 0.5) * scale;
            for px in 0..w {
                let x0 = cx + (px as f64 / w as f64 - 0.5) * scale * aspect;
                let q = (x0 - 0.25).powi(2) + y0 * y0;
                let inside = q * (q + (x0 - 0.25)) <= 0.25 * y0 * y0 || (x0 + 1.0).powi(2) + y0 * y0 <= 0.0625;
                let (mut x, mut y, mut n) = (0.0f64, 0.0f64, 0u32);
                if !inside {
                    while x * x + y * y <= 256.0 && n < max_iter {
                        let xt = x * x - y * y + x0;
                        y = 2.0 * x * y + y0;
                        x = xt;
                        n += 1;
                    }
                }
                let o = (py * w + px) * 4;
                if inside || n >= max_iter {
                    buf[o..o + 4].copy_from_slice(&[8, 10, 24, 255]);
                } else {
                    let mu = n as f64 + 1.0 - ((x * x + y * y).ln() * 0.5).ln() / std::f64::consts::LN_2;
                    let [r, g, b] = palette(mu * 0.025, scheme);
                    buf[o..o + 4].copy_from_slice(&[r, g, b, 255]);
                }
            }
        }
        buf.as_ptr()
    })
}

fn next_rand() -> f64 {
    RNG.with(|r| {
        let mut x = *r.borrow();
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        *r.borrow_mut() = x;
        (x >> 11) as f64 / (1u64 << 53) as f64
    })
}
#[no_mangle]
pub extern "C" fn kernel_task_cpu(t: f64) -> f64 {
    let wobble = ((t * 0.7).sin() * (t * 1.3).cos()).abs();
    180.0 + wobble * 190.0 + next_rand() * 40.0
}
#[no_mangle]
pub extern "C" fn entropy() -> f64 {
    next_rand()
}
#[no_mangle]
pub unsafe extern "C" fn password_strength(ptr: *const u8, len: usize) -> u32 {
    let pw = str_from(ptr, len);
    let lower = pw.to_ascii_lowercase();
    if pw.is_empty() || ["password", "123456", "qwerty", "hunter2", "pear", "letmein"].iter().any(|b| lower.contains(b)) {
        return 0;
    }
    let classes = [
        pw.bytes().any(|c| c.is_ascii_lowercase()),
        pw.bytes().any(|c| c.is_ascii_uppercase()),
        pw.bytes().any(|c| c.is_ascii_digit()),
        pw.bytes().any(|c| !c.is_ascii_alphanumeric()),
    ]
    .iter()
    .filter(|b| **b)
    .count() as u32;
    let length_score = match pw.chars().count() {
        0..=5 => 0,
        6..=9 => 1,
        10..=13 => 2,
        _ => 3,
    };
    ((length_score + classes) / 2).min(4)
}

#[no_mangle]
pub unsafe extern "C" fn junk_score(ptr: *const u8, len: usize) -> f64 {
    junk::score(str_from(ptr, len))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn c(s: &str) -> f64 {
        unsafe { calc(s.as_ptr(), s.len()) }
    }
    #[test]
    fn math() {
        assert_eq!(c("2+2"), 4.0);
        assert_eq!(c("2+3*4"), 14.0);
        assert_eq!(c("(2+3)*4"), 20.0);
        assert_eq!(c("2^3^2"), 512.0);
        assert_eq!(c("-2^2"), -4.0);
        assert_eq!(c("50%"), 0.5);
        assert_eq!(c("10 % 3"), 1.0);
        assert_eq!(c("5!"), 120.0);
        assert!((c("2pi") - std::f64::consts::TAU).abs() < 1e-12);
        assert_eq!(c("sqrt 16"), 4.0);
        assert_eq!(c("sqrt(16)+1"), 5.0);
        assert_eq!(c("8gb"), 16.0);
        assert!(c("2+").is_nan());
        assert!(c("hello").is_nan());
    }
}
