const SPAM: &[(&str, f64)] = &[
    ("free", 1.1), ("winner", 1.8), ("won", 1.2), ("prize", 1.6), ("urgent", 1.4), ("immediately", 0.9),
    ("verify", 1.0), ("verification", 0.7), ("suspended", 1.6), ("locked", 1.0), ("crypto", 1.5),
    ("bitcoin", 1.5), ("nft", 1.4), ("guaranteed", 1.5), ("congratulations", 1.6), ("claim", 1.3),
    ("click", 1.1), ("offer", 0.9), ("limited", 0.9), ("exclusive", 0.9), ("act", 0.6), ("now", 0.5),
    ("prince", 1.8), ("inheritance", 2.0), ("beneficiary", 1.8), ("wire", 1.1), ("gift", 0.8),
    ("card", 0.4), ("cash", 1.1), ("investment", 1.0), ("returns", 0.8), ("risk", 0.5), ("miracle", 1.6),
    ("ram", 0.7), ("download", 0.6), ("unsubscribe", 0.8), ("dear", 0.9), ("customer", 0.8),
    ("password", 0.9), ("account", 0.6), ("warranty", 1.3), ("extended", 0.8), ("expires", 0.7),
    ("lottery", 2.0), ("100%", 1.2), ("$$$", 2.0), ("discount", 1.0), ("deal", 0.7), ("hot", 0.8),
    ("singles", 1.8), ("viagra", 3.0), ("loan", 1.3), ("pre-approved", 1.8), ("kindly", 1.4),
];

const HAM: &[(&str, f64)] = &[
    ("thanks", 0.9), ("thank", 0.7), ("meeting", 0.8), ("tomorrow", 0.6), ("lunch", 0.9), ("patch", 1.2),
    ("attached", 0.7), ("regards", 0.6), ("cheers", 0.8), ("kernel", 0.8), ("review", 0.7), ("commit", 1.0),
    ("build", 0.6), ("bug", 0.7), ("fix", 0.7), ("mom", 1.2), ("dinner", 0.9), ("photos", 0.6),
    ("love", 0.5), ("sorry", 0.6), ("question", 0.5), ("draft", 0.6), ("notes", 0.5), ("agenda", 0.8),
];

pub fn score(text: &str) -> f64 {
    let lower = text.to_ascii_lowercase();
    let mut z = -2.2;
    for word in lower.split(|c: char| !(c.is_ascii_alphanumeric() || c == '%' || c == '$' || c == '-')) {
        if word.is_empty() {
            continue;
        }
        if let Some((_, w)) = SPAM.iter().find(|(t, _)| *t == word) {
            z += w;
        }
        if let Some((_, w)) = HAM.iter().find(|(t, _)| *t == word) {
            z -= w;
        }
    }
    let letters = text.chars().filter(|c| c.is_ascii_alphabetic()).count().max(1) as f64;
    let caps = text.chars().filter(|c| c.is_ascii_uppercase()).count() as f64 / letters;
    if caps > 0.3 {
        z += (caps - 0.3) * 8.0;
    }
    z += (text.matches('!').count() as f64 * 0.35).min(2.5);
    z += (text.matches('$').count() as f64 * 0.4).min(2.0);
    z += (lower.matches("http").count() as f64 * 0.5).min(1.5);
    1.0 / (1.0 + (-z).exp())
}

#[cfg(test)]
mod tests {
    use super::score;
    #[test]
    fn spam_scores_high() {
        assert!(score("CONGRATULATIONS!!! You WON a FREE prize. Claim now: http://totally.legit") > 0.95);
        assert!(score("Dear customer, kindly verify your account or it will be suspended") > 0.8);
    }
    #[test]
    fn ham_scores_low() {
        assert!(score("Thanks for the patch, I'll review it tomorrow before the meeting. Cheers") < 0.1);
        assert!(score("") < 0.2);
    }
}
