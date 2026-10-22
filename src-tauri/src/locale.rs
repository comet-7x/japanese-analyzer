// Keep in sync with app/i18n/index.ts. Unknown values never reach the UI.
pub fn saved_locale<'a>(values: impl Iterator<Item = &'a str>) -> &'a str {
    values
        .filter(|value| matches!(*value, "zh-CN" | "zh-TW" | "en" | "ko"))
        .next()
        .unwrap_or("zh-CN")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launcher_matches_the_homepage_default_and_saved_languages() {
        assert_eq!(saved_locale(std::iter::empty()), "zh-CN");
        for locale in ["zh-CN", "zh-TW", "en", "ko"] {
            assert_eq!(saved_locale(["invalid", locale].into_iter()), locale);
        }
        assert_eq!(saved_locale(["ja", "<script>"].into_iter()), "zh-CN");
    }
}
