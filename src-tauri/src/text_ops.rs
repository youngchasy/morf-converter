use std::{collections::BTreeSet, fs, path::Path};

use serde_json::{Map, Value};

fn is_plain_text_format(value: &str) -> bool {
    matches!(
        value,
        "txt"
            | "md"
            | "markdown"
            | "js"
            | "jsx"
            | "ts"
            | "tsx"
            | "py"
            | "rs"
            | "go"
            | "java"
            | "c"
            | "cpp"
            | "h"
            | "css"
            | "scss"
            | "sql"
            | "sh"
            | "srt"
            | "vtt"
            | "xml"
    )
}

fn read_value(input: &Path, source_format: &str) -> Result<Value, String> {
    let source = fs::read_to_string(input)
        .map_err(|error| format!("Не удалось прочитать {}: {error}", input.display()))?;
    match source_format {
        "json" => {
            serde_json::from_str(&source).map_err(|error| format!("Некорректный JSON: {error}"))
        }
        "yaml" | "yml" => {
            let value: serde_yaml::Value = serde_yaml::from_str(&source)
                .map_err(|error| format!("Некорректный YAML: {error}"))?;
            serde_json::to_value(value).map_err(|error| error.to_string())
        }
        "toml" => {
            let value: toml::Value =
                toml::from_str(&source).map_err(|error| format!("Некорректный TOML: {error}"))?;
            serde_json::to_value(value).map_err(|error| error.to_string())
        }
        "csv" => read_csv(input),
        value if is_plain_text_format(value) => Ok(Value::String(source)),
        _ => Err(format!(
            "Чтение .{source_format} нативным движком не поддерживается"
        )),
    }
}

fn read_csv(input: &Path) -> Result<Value, String> {
    let mut reader =
        csv::Reader::from_path(input).map_err(|error| format!("Некорректный CSV: {error}"))?;
    let headers = reader
        .headers()
        .map_err(|error| format!("Не удалось прочитать заголовок CSV: {error}"))?
        .clone();
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|error| format!("Некорректная строка CSV: {error}"))?;
        let mut row = Map::new();
        for (header, value) in headers.iter().zip(record.iter()) {
            row.insert(header.to_string(), Value::String(value.to_string()));
        }
        rows.push(Value::Object(row));
    }
    Ok(Value::Array(rows))
}

fn write_csv(output: &Path, value: &Value) -> Result<(), String> {
    let rows = value
        .as_array()
        .ok_or_else(|| "Для CSV ожидается массив объектов".to_string())?;
    let mut headers = BTreeSet::new();
    for row in rows {
        let object = row
            .as_object()
            .ok_or_else(|| "Каждая строка CSV должна быть объектом".to_string())?;
        headers.extend(object.keys().cloned());
    }
    let headers = headers.into_iter().collect::<Vec<_>>();
    let mut writer = csv::Writer::from_path(output)
        .map_err(|error| format!("Не удалось создать CSV: {error}"))?;
    writer
        .write_record(&headers)
        .map_err(|error| format!("Не удалось записать CSV: {error}"))?;
    for row in rows {
        let object = row.as_object().expect("rows validated above");
        let record = headers
            .iter()
            .map(|header| match object.get(header) {
                Some(Value::String(value)) => value.clone(),
                Some(value) if !value.is_null() => value.to_string(),
                _ => String::new(),
            })
            .collect::<Vec<_>>();
        writer
            .write_record(record)
            .map_err(|error| format!("Не удалось записать CSV: {error}"))?;
    }
    writer
        .flush()
        .map_err(|error| format!("Не удалось завершить CSV: {error}"))
}

pub fn is_native_data_format(value: &str) -> bool {
    matches!(value, "json" | "yaml" | "yml" | "toml" | "csv") || is_plain_text_format(value)
}

pub fn convert(
    input: &Path,
    output: &Path,
    source_format: &str,
    target_format: &str,
) -> Result<(), String> {
    let value = read_value(input, source_format)?;
    match target_format {
        "json" => fs::write(
            output,
            serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("Не удалось записать JSON: {error}")),
        "yaml" | "yml" => fs::write(
            output,
            serde_yaml::to_string(&value).map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("Не удалось записать YAML: {error}")),
        "toml" => fs::write(
            output,
            toml::to_string_pretty(&value)
                .map_err(|error| format!("Нельзя представить как TOML: {error}"))?,
        )
        .map_err(|error| format!("Не удалось записать TOML: {error}")),
        "csv" => write_csv(output, &value),
        target if is_plain_text_format(target) => {
            let text = value.as_str().map(ToOwned::to_owned).unwrap_or_else(|| {
                serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string())
            });
            fs::write(output, text).map_err(|error| format!("Не удалось записать текст: {error}"))
        }
        _ => Err(format!(
            "Запись .{target_format} нативным движком не поддерживается"
        )),
    }
}
