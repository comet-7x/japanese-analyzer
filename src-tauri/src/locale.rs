// Keep the language negotiation contract aligned with tauri-ui/locale.mjs.
pub fn system_locale<'a>(languages: impl Iterator<Item = &'a str>) -> &'static str {
    for raw in languages {
        let normalized = raw.replace('_', "-").to_ascii_lowercase();
        let parts: Vec<_> = normalized.split('-').collect();
        match parts[0] {
            "en" => return "en",
            "ko" => return "ko",
            "zh" => {
                if parts.contains(&"hant") {
                    return "zh-TW";
                }
                if parts.contains(&"hans") {
                    return "zh-CN";
                }
                return if parts.iter().any(|part| matches!(*part, "tw" | "hk" | "mo")) {
                    "zh-TW"
                } else {
                    "zh-CN"
                };
            }
            _ => {}
        }
    }
    "zh-CN"
}

pub fn saved_locale<'a>(values: impl Iterator<Item = &'a str>) -> Option<&'a str> {
    values
        .filter(|value| matches!(*value, "zh-CN" | "zh-TW" | "en" | "ko"))
        .next()
}

#[cfg(target_os = "macos")]
pub fn preferred_languages() -> Vec<String> {
    objc2_foundation::NSLocale::preferredLanguages()
        .iter()
        .map(|language| language.to_string())
        .collect()
}

#[cfg(target_os = "windows")]
pub fn preferred_languages() -> Vec<String> {
    // Win32 returns the user's ordered display-language list, not region/keyboard settings.
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetUserPreferredUILanguages(
            flags: u32,
            count: *mut u32,
            buffer: *mut u16,
            length: *mut u32,
        ) -> i32;
    }
    const MUI_LANGUAGE_NAME: u32 = 0x8;
    let (mut count, mut length) = (0, 0);
    // SAFETY: The first call sizes the buffer; the second receives a writable UTF-16
    // allocation of that size. Parse only the reported initialized length.
    unsafe {
        if GetUserPreferredUILanguages(
            MUI_LANGUAGE_NAME,
            &mut count,
            std::ptr::null_mut(),
            &mut length,
        ) == 0
            || length == 0
            || length > 65536
        {
            return Vec::new();
        }
        let mut buffer = vec![0u16; length as usize];
        if GetUserPreferredUILanguages(
            MUI_LANGUAGE_NAME,
            &mut count,
            buffer.as_mut_ptr(),
            &mut length,
        ) == 0
        {
            return Vec::new();
        }
        buffer.truncate(length as usize);
        buffer
            .split(|value| *value == 0)
            .filter(|value| !value.is_empty())
            .filter_map(|value| String::from_utf16(value).ok())
            .collect()
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn preferred_languages() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_languages_remain_manual_and_missing_values_follow_the_system() {
        assert_eq!(saved_locale(std::iter::empty()), None);
        assert_eq!(saved_locale(["system", "invalid"].into_iter()), None);
        for locale in ["zh-CN", "zh-TW", "en", "ko"] {
            assert_eq!(saved_locale([locale].into_iter()), Some(locale));
        }
    }
    #[test]
    fn native_and_web_negotiation_share_the_same_contract() {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/system-language.json"))
                .unwrap();
        for case in cases.as_array().unwrap() {
            let languages: Vec<_> = case["languages"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_str().unwrap())
                .collect();
            assert_eq!(
                system_locale(languages.into_iter()),
                case["expected"].as_str().unwrap(),
                "{case}"
            );
        }
    }
    #[test]
    fn native_language_reader_returns_an_ordered_list() {
        let languages = preferred_languages();
        assert!(languages.iter().all(|value| !value.is_empty()));
        println!("Native preferred language count: {}", languages.len());
    }
}
