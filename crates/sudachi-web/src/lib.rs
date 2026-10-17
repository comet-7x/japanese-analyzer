use serde::Serialize;
use std::sync::Arc;
use sudachi::{
    analysis::{stateless_tokenizer::StatelessTokenizer, Mode, Tokenize},
    config::ConfigBuilder,
    dic::{
        dictionary::JapaneseDictionary,
        storage::{Storage, SudachiDicData},
    },
    prelude::MorphemeView,
};
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Token {
    word: String,
    pos: Vec<String>,
    reading: String,
    lemma: String,
    unknown: bool,
    expanded_parts: usize,
}

#[wasm_bindgen]
pub struct SudachiTokenizer {
    tokenizer: StatelessTokenizer<Arc<JapaneseDictionary>>,
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

#[wasm_bindgen]
impl SudachiTokenizer {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<SudachiTokenizer, JsValue> {
        let cfg = ConfigBuilder::from_embedded()
            .map_err(js_error)?
            .push_embedded()
            .build();
        let storage = SudachiDicData::new(Storage::Owned(bytes));
        let dictionary = JapaneseDictionary::from_cfg_storage(&cfg, storage).map_err(js_error)?;
        Ok(Self {
            tokenizer: StatelessTokenizer::new(Arc::new(dictionary)),
        })
    }

    pub fn tokenize(&self, text: &str) -> Result<JsValue, JsValue> {
        // Bounds are checked again at the application boundary before worker work.
        if text.len() > 60_000 {
            return Err(JsValue::from_str("Local input too long"));
        }
        let list = self
            .tokenizer
            .tokenize(text, Mode::A, false)
            .map_err(js_error)?;
        let mut tokens: Vec<Token> = Vec::with_capacity(list.len());
        let mut previous_end = usize::MAX;
        for item in list.iter() {
            let word = item.surface().to_string();
            if word.is_empty() && item.begin() == item.end() && item.end() == previous_end {
                if let Some(previous) = tokens.last_mut() {
                    previous.reading.push_str(item.reading_form());
                    previous.expanded_parts += 1;
                    continue;
                }
            }
            tokens.push(Token {
                word,
                pos: item.part_of_speech().to_vec(),
                reading: item.reading_form().to_owned(),
                lemma: item.dictionary_form().to_owned(),
                unknown: item.is_oov(),
                expanded_parts: 0,
            });
            previous_end = item.end();
        }
        serde_wasm_bindgen::to_value(&tokens).map_err(js_error)
    }
}
